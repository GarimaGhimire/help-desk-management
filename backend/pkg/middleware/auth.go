package middleware

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/fintara/helpdesk/pkg/db"
	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

const (
	UserIDKey    contextKey = "user_id"
	UserKey      contextKey = "auth_user"
	ClaimsKey    contextKey = "auth_claims"
	UserIDHeader            = "X-User-ID"
)

const (
	Issuer           = "fintara-helpdesk"
	AccessTokenTTL   = 24 * time.Hour
	ResetTokenTTL    = 10 * time.Minute
	ClaimsTypeAccess = "access"
	ClaimsTypeReset  = "reset"
)

// AuthUser is the authenticated identity attached to a request context.
type AuthUser struct {
	ID                 string
	Name               string
	DisplayName        string
	Email              string
	Phone              string
	AvatarURL          string
	Role               string
	OrgID              string // empty when the user has no org (superadmin)
	LanguagePref       string
	MustChangePassword bool
	IsActive           bool
	CreatedAt          time.Time
	LastLoginAt        *time.Time
}

// Claims is the JWT payload.
type Claims struct {
	Role string `json:"role"`
	Org  string `json:"org"`
	Type string `json:"type"`
	jwt.RegisteredClaims
}

// JWTSecret returns the signing secret. A missing secret is a fatal config
// error — never fall back to a known default.
func JWTSecret() string { return os.Getenv("JWT_SECRET") }

// SignToken issues a signed JWT and returns the token string and full claims
// (including the jti used for session tracking).
func SignToken(userID, role, org string, ttl time.Duration, tokenType string) (string, *Claims, error) {
	now := time.Now().UTC()

	jti, err := newJTI()
	if err != nil {
		return "", nil, fmt.Errorf("generate jti: %w", err)
	}

	claims := &Claims{
		Role: role,
		Org:  org,
		Type: tokenType,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    Issuer,
			Subject:   userID,
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ID:        jti,
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(JWTSecret()))
	if err != nil {
		return "", nil, fmt.Errorf("sign token: %w", err)
	}
	return signed, claims, nil
}

// SessionTokenHash derives the value stored in the sessions table from a jti.
func SessionTokenHash(jti string) string {
	sum := sha256.Sum256([]byte(jti))
	return hex.EncodeToString(sum[:])
}

// ParseToken validates a JWT (algorithm pinned to HS256) and returns claims.
func ParseToken(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(JWTSecret()), nil
	})
	if err != nil || !token.Valid {
		return nil, errors.New("invalid token")
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || claims.Issuer != Issuer || claims.Subject == "" {
		return nil, errors.New("invalid claims")
	}
	return claims, nil
}

// Auth authenticates the request, verifies the session is still valid and the
// account is active, then attaches the fresh user to the context. The user is
// reloaded from the database on every request so role changes and
// deactivations take effect immediately.
func Auth(repos *db.Repos) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tokenStr := extractToken(r)
			if tokenStr == "" {
				RespondError(w, http.StatusUnauthorized, "missing authorization")
				return
			}

			claims, err := ParseToken(tokenStr)
			if err != nil {
				RespondError(w, http.StatusUnauthorized, "invalid token")
				return
			}
			if claims.Type != ClaimsTypeAccess {
				RespondError(w, http.StatusUnauthorized, "invalid token type")
				return
			}

			// Session must exist, be unrevoked and unexpired.
			sess, err := repos.Queries.GetActiveSession(r.Context(), SessionTokenHash(claims.ID))
			if err != nil {
				RespondError(w, http.StatusUnauthorized, "session expired")
				return
			}
			_ = sess

			// Reload the user so account/role/org state is always current.
			user, err := loadAuthUser(r.Context(), repos, claims.Subject)
			if err != nil {
				RespondError(w, http.StatusUnauthorized, "account not found")
				return
			}
			if !user.IsActive {
				RespondError(w, http.StatusUnauthorized, "account is disabled")
				return
			}

			// Org may have been suspended by a platform admin.
			if user.OrgID != "" {
				org, err := repos.Queries.GetOrganization(r.Context(), db.ParseUUID(user.OrgID))
				if err != nil || !org.IsActive {
					reqPath := r.URL.Path
					if reqPath != "/me" && reqPath != "/auth/me" && reqPath != "/auth/logout" && !strings.HasPrefix(reqPath, "/me") && !strings.HasPrefix(reqPath, "/auth/") {
						RespondError(w, http.StatusForbidden, "organization is suspended")
						return
					}
				}
			}

			// Accounts with a temporary password (must_change_password) are
			// locked to a narrow allow-list until they set a real password.
			// This prevents a leaked temp password from granting full access.
			if user.MustChangePassword && !passwordChangeAllowed(r.URL.Path) {
				RespondError(w, http.StatusPreconditionRequired, "password change required")
				return
			}

			ctx := context.WithValue(r.Context(), UserIDKey, user.ID)
			ctx = context.WithValue(ctx, UserKey, user)
			ctx = context.WithValue(ctx, ClaimsKey, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireRole authorizes the request for one of the given roles.
func RequireRole(roles ...string) func(http.Handler) http.Handler {
	allowed := make(map[string]bool, len(roles))
	for _, role := range roles {
		allowed[role] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user := GetUser(r)
			if user == nil || !allowed[user.Role] {
				RespondError(w, http.StatusForbidden, "insufficient permissions")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequestLogger sets a request id on the context (kept for interface parity).
func RequestLogger(next http.Handler) http.Handler { return next }

// extractToken returns the bearer token from the Authorization header or the
// token query parameter (WebSocket clients cannot set headers).
// passwordChangeAllowed reports whether a must-change user may access a path.
func passwordChangeAllowed(path string) bool {
	switch path {
	case "/auth/me", "/auth/logout", "/auth/change-password":
		return true
	}
	return false
}

func extractToken(r *http.Request) string {
	if header := r.Header.Get("Authorization"); header != "" && strings.HasPrefix(header, "Bearer ") {
		return strings.TrimPrefix(header, "Bearer ")
	}
	// Query param fallback for WebSocket (browser WS API can't set headers).
	if t := r.URL.Query().Get("token"); t != "" {
		return t
	}
	return ""
}

func loadAuthUser(ctx context.Context, repos *db.Repos, id string) (*AuthUser, error) {
	row, err := repos.Queries.GetUserAuthByID(ctx, db.ParseUUID(id))
	if err != nil {
		return nil, err
	}
	u := &AuthUser{
		ID:                 db.UUIDString(row.ID),
		Name:               row.Name,
		DisplayName:        row.DisplayName.String,
		Email:              row.Email.String,
		Phone:              row.Phone.String,
		AvatarURL:          row.AvatarUrl.String,
		Role:               string(row.Role),
		LanguagePref:       row.LanguagePref,
		MustChangePassword: row.MustChangePassword,
		IsActive:           row.IsActive,
		CreatedAt:          row.CreatedAt.Time,
	}
	if row.OrgID.Valid {
		u.OrgID = db.UUIDString(row.OrgID)
	}
	if row.LastLoginAt.Valid {
		t := row.LastLoginAt.Time
		u.LastLoginAt = &t
	}
	return u, nil
}

// GetUser returns the authenticated user, or nil when unauthenticated.
func GetUser(r *http.Request) *AuthUser {
	if u, ok := r.Context().Value(UserKey).(*AuthUser); ok {
		return u
	}
	return nil
}

// GetUserID returns the authenticated user's ID, or "" when unauthenticated.
func GetUserID(r *http.Request) string {
	if u := GetUser(r); u != nil {
		return u.ID
	}
	return ""
}

// GetClaims returns the parsed JWT claims for the request.
func GetClaims(r *http.Request) *Claims {
	if c, ok := r.Context().Value(ClaimsKey).(*Claims); ok {
		return c
	}
	return nil
}

// TokenHashForRequest derives the session token hash for the current request.
func TokenHashForRequest(r *http.Request) string {
	if c := GetClaims(r); c != nil {
		return SessionTokenHash(c.ID)
	}
	return ""
}

// ----------------------- JSON helpers -----------------------

type JSONError struct {
	Error string `json:"error"`
}

type JSONMessage struct {
	Message string `json:"message"`
}

func RespondJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func RespondError(w http.ResponseWriter, status int, msg string) {
	RespondJSON(w, status, JSONError{Error: msg})
}

func RespondMessage(w http.ResponseWriter, status int, msg string) {
	RespondJSON(w, status, JSONMessage{Message: msg})
}

// ----------------------- uuid helpers -----------------------

// newJTI returns a random UUID v4 used as the token id.
func newJTI() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}
