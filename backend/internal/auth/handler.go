package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"time"

	sqldb "github.com/fintara/helpdesk/internal/db"
	"github.com/fintara/helpdesk/pkg/audit"
	"github.com/fintara/helpdesk/pkg/db"
	"github.com/fintara/helpdesk/pkg/mailer"
	"github.com/fintara/helpdesk/pkg/middleware"
	"github.com/fintara/helpdesk/pkg/password"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	maxOTPAttempts         = 5
	maxOTPRequestsPerHour  = 5
	invalidCredentialsMsg  = "invalid email, phone or password"
	invalidOTPMsg          = "invalid or expired code"
)

type Service struct {
	repos *db.Repos
	mail  *mailer.Mailer
}

func Handlers(repos *db.Repos, mail *mailer.Mailer) chi.Router {
	s := &Service{repos: repos, mail: mail}

	r := chi.NewRouter()
	r.Post("/login", s.login)
	r.Post("/request-otp", s.requestOTP)
	r.Post("/verify-otp", s.verifyOTP)
	r.Post("/reset-password", s.resetPassword)

	r.Group(func(r chi.Router) {
		r.Use(middleware.Auth(repos))
		r.Post("/change-password", s.changePassword)
		r.Post("/logout", s.logout)
		r.Get("/me", s.me)
	})
	return r
}

// ------------------------------ password login ------------------------------

func (s *Service) login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Contact  string `json:"contact"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.RespondError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Contact = strings.TrimSpace(req.Contact)
	if req.Contact == "" || req.Password == "" {
		middleware.RespondError(w, http.StatusBadRequest, "contact and password are required")
		return
	}

	user, err := s.repos.Queries.GetUserAuthByContact(r.Context(), db.ParseText(req.Contact))
	if err != nil || !user.PasswordHash.Valid {
		// generic error to avoid user enumeration
		middleware.RespondError(w, http.StatusUnauthorized, invalidCredentialsMsg)
		return
	}
	if !user.IsActive {
		middleware.RespondError(w, http.StatusUnauthorized, "account is disabled")
		return
	}
	if !password.Compare(user.PasswordHash.String, req.Password) {
		middleware.RespondError(w, http.StatusUnauthorized, invalidCredentialsMsg)
		return
	}

	token, _, err := s.issueAccessToken(r.Context(), &user)
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to sign in")
		return
	}

	_ = s.repos.Queries.UpdateLastLogin(r.Context(), user.ID)

	audit.Log(r, s.repos, "auth.login", "user", user.ID, nil)

	middleware.RespondJSON(w, http.StatusOK, map[string]interface{}{
		"token":                token,
		"must_change_password": user.MustChangePassword,
	})
}

// ------------------------------ OTP flow ------------------------------

func (s *Service) requestOTP(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Contact string `json:"contact"`
		Purpose string `json:"purpose"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.RespondError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Contact = strings.TrimSpace(req.Contact)
	if req.Contact == "" {
		middleware.RespondError(w, http.StatusBadRequest, "contact is required")
		return
	}

	purpose, ok := parsePurpose(req.Purpose)
	if !ok {
		middleware.RespondError(w, http.StatusBadRequest, "purpose must be login or password_reset")
		return
	}

	user, err := s.repos.Queries.GetUserAuthByContact(r.Context(), db.ParseText(req.Contact))
	if err != nil {
		// Always return 202 — never reveal whether an account exists.
		middleware.RespondMessage(w, http.StatusAccepted, "if that contact exists, a code was sent")
		return
	}
	if user.Email.String == "" {
		s.logOTPSendFailure(req.Contact, "user has no email address on file")
		middleware.RespondMessage(w, http.StatusAccepted, "if that contact exists, a code was sent")
		return
	}

	count, err := s.repos.Queries.CountRecentOTPRequests(r.Context(), sqldb.CountRecentOTPRequestsParams{
		UserID:  user.ID,
		Purpose: purpose,
	})
	if err == nil && count >= maxOTPRequestsPerHour {
		middleware.RespondError(w, http.StatusTooManyRequests, "too many requests, try again later")
		return
	}

	code, err := generateNumericCode()
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to generate code")
		return
	}

	_, err = s.repos.Queries.CreateOTP(r.Context(), sqldb.CreateOTPParams{
		UserID:  user.ID,
		Code:    hashCode(code),
		Channel: sqldb.OtpChannelEmail,
		Purpose: purpose,
	})
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to create code")
		return
	}

	email := user.Email.String
	name := user.Name
	if purpose == sqldb.OtpPurposePasswordReset {
		err = s.mail.SendPasswordResetOTP(email, name, code)
	} else {
		err = s.mail.SendLoginOTP(email, name, code)
	}
	if err != nil {
		s.logOTPSendFailure(req.Contact, err.Error())
	}

	middleware.RespondMessage(w, http.StatusAccepted, "if that contact exists, a code was sent")
}

func (s *Service) verifyOTP(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Contact string `json:"contact"`
		Code    string `json:"code"`
		Purpose string `json:"purpose"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.RespondError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Contact = strings.TrimSpace(req.Contact)
	req.Code = strings.TrimSpace(req.Code)
	purpose, ok := parsePurpose(req.Purpose)
	if !ok || req.Contact == "" || req.Code == "" {
		middleware.RespondError(w, http.StatusBadRequest, "contact, code and purpose are required")
		return
	}

	user, err := s.repos.Queries.GetUserAuthByContact(r.Context(), db.ParseText(req.Contact))
	if err != nil {
		middleware.RespondError(w, http.StatusUnauthorized, invalidOTPMsg)
		return
	}
	if !user.IsActive {
		middleware.RespondError(w, http.StatusUnauthorized, "account is disabled")
		return
	}

	otp, err := s.repos.Queries.GetLatestValidOTP(r.Context(), sqldb.GetLatestValidOTPParams{
		UserID:  user.ID,
		Channel: sqldb.OtpChannelEmail,
		Purpose: purpose,
	})
	if err != nil {
		middleware.RespondError(w, http.StatusUnauthorized, invalidOTPMsg)
		return
	}

	if otp.Attempts >= maxOTPAttempts {
		middleware.RespondError(w, http.StatusTooManyRequests, "too many attempts, request a new code")
		return
	}

	if !constantTimeEqual(otp.Code, hashString(req.Code)) {
		_ = s.repos.Queries.IncrementOTPAttempts(r.Context(), otp.ID)
		middleware.RespondError(w, http.StatusUnauthorized, invalidOTPMsg)
		return
	}

	if otp.ExpiresAt.Time.Before(time.Now()) {
		middleware.RespondError(w, http.StatusUnauthorized, invalidOTPMsg)
		return
	}

	_ = s.repos.Queries.MarkOTPVerified(r.Context(), otp.ID)

	if purpose == sqldb.OtpPurposePasswordReset {
		// Return a short-lived, single-purpose reset token.
		resetToken, _, err := middleware.SignToken(
			db.UUIDString(user.ID), "", "", middleware.ResetTokenTTL, middleware.ClaimsTypeReset,
		)
		if err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "failed to create reset token")
			return
		}
		audit.Log(r, s.repos, "auth.otp_verified_reset", "user", user.ID, nil)
		middleware.RespondJSON(w, http.StatusOK, map[string]string{"reset_token": resetToken})
		return
	}

	token, _, err := s.issueAccessToken(r.Context(), &user)
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to sign in")
		return
	}

	_ = s.repos.Queries.UpdateLastLogin(r.Context(), user.ID)
	audit.Log(r, s.repos, "auth.login_otp", "user", user.ID, nil)

	middleware.RespondJSON(w, http.StatusOK, map[string]interface{}{
		"token":                token,
		"must_change_password": user.MustChangePassword,
	})
}

// ------------------------------ password management ------------------------------

func (s *Service) changePassword(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.RespondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	row, err := s.repos.Queries.GetUserAuthByID(r.Context(), db.ParseUUID(me.ID))
	if err != nil || !row.PasswordHash.Valid {
		middleware.RespondError(w, http.StatusUnauthorized, invalidCredentialsMsg)
		return
	}
	if !password.Compare(row.PasswordHash.String, req.CurrentPassword) {
		middleware.RespondError(w, http.StatusUnauthorized, "current password is incorrect")
		return
	}
	if err := password.ValidatePolicy(req.NewPassword); err != nil {
		middleware.RespondError(w, http.StatusBadRequest, err.Error())
		return
	}
	if password.Compare(row.PasswordHash.String, req.NewPassword) {
		middleware.RespondError(w, http.StatusBadRequest, "new password must be different from the current one")
		return
	}

	hashed, err := password.Hash(req.NewPassword)
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to update password")
		return
	}

	if err := s.repos.Queries.UpdatePasswordHash(r.Context(), sqldb.UpdatePasswordHashParams{
		ID:           row.ID,
		PasswordHash: db.ParseText(hashed),
	}); err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to update password")
		return
	}

	// Revoke every other session so only this login stays valid.
	_ = s.repos.Queries.RevokeOtherSessions(r.Context(), sqldb.RevokeOtherSessionsParams{
		UserID: row.ID,
		ID:     db.ParseUUID(middleware.GetClaims(r).ID),
	})

	audit.Log(r, s.repos, "auth.change_password", "user", row.ID, nil)
	middleware.RespondMessage(w, http.StatusOK, "password updated")
}

func (s *Service) resetPassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ResetToken  string `json:"reset_token"`
		NewPassword string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.RespondError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.ResetToken == "" || req.NewPassword == "" {
		middleware.RespondError(w, http.StatusBadRequest, "reset_token and new_password are required")
		return
	}

	claims, err := middleware.ParseToken(req.ResetToken)
	if err != nil || claims.Type != middleware.ClaimsTypeReset {
		middleware.RespondError(w, http.StatusUnauthorized, "invalid or expired reset token")
		return
	}

	if err := password.ValidatePolicy(req.NewPassword); err != nil {
		middleware.RespondError(w, http.StatusBadRequest, err.Error())
		return
	}

	row, err := s.repos.Queries.GetUserAuthByID(r.Context(), db.ParseUUID(claims.Subject))
	if err != nil {
		middleware.RespondError(w, http.StatusUnauthorized, "account not found")
		return
	}
	if password.Compare(row.PasswordHash.String, req.NewPassword) {
		middleware.RespondError(w, http.StatusBadRequest, "new password must be different from the current one")
		return
	}

	hashed, err := password.Hash(req.NewPassword)
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to update password")
		return
	}

	if err := s.repos.Queries.UpdatePasswordHash(r.Context(), sqldb.UpdatePasswordHashParams{
		ID:           row.ID,
		PasswordHash: db.ParseText(hashed),
	}); err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to update password")
		return
	}

	// Invalidate all existing sessions — password changed at an untrusted device.
	_ = s.repos.Queries.RevokeAllUserSessions(r.Context(), row.ID)
	audit.Log(r, s.repos, "auth.reset_password", "user", row.ID, nil)

	middleware.RespondMessage(w, http.StatusOK, "password updated")
}

func (s *Service) logout(w http.ResponseWriter, r *http.Request) {
	hash := middleware.TokenHashForRequest(r)
	if hash != "" {
		_ = s.repos.Queries.RevokeSession(r.Context(), hash)
	}
	middleware.RespondMessage(w, http.StatusOK, "logged out")
}

func (s *Service) me(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	resp := map[string]interface{}{
		"id":                   me.ID,
		"name":                 me.Name,
		"display_name":         me.DisplayName,
		"email":                me.Email,
		"phone":                me.Phone,
		"avatar_url":           me.AvatarURL,
		"role":                 me.Role,
		"org_id":               me.OrgID,
		"language_pref":        me.LanguagePref,
		"must_change_password": me.MustChangePassword,
		"is_active":            true,
		"created_at":           me.CreatedAt.Format(time.RFC3339),
	}

	if me.LastLoginAt != nil {
		resp["last_login_at"] = me.LastLoginAt.Format(time.RFC3339)
	}

	if me.OrgID != "" {
		if org, err := s.repos.Queries.GetOrganization(r.Context(), db.ParseUUID(me.OrgID)); err == nil {
			resp["org"] = map[string]interface{}{
				"id":   db.UUIDString(org.ID),
				"name": org.Name,
				"slug": org.Slug,
			}
		}
	}

	middleware.RespondJSON(w, http.StatusOK, resp)
}

// ------------------------------ helpers ------------------------------

func (s *Service) issueAccessToken(ctx context.Context, user *sqldb.GetUserAuthByContactRow) (string, interface{}, error) {
	token, claims, err := middleware.SignToken(
		db.UUIDString(user.ID), string(user.Role), db.UUIDString(user.OrgID),
		middleware.AccessTokenTTL, middleware.ClaimsTypeAccess,
	)
	if err != nil {
		return "", nil, err
	}

	_, err = s.repos.Queries.CreateSession(ctx, sqldb.CreateSessionParams{
		UserID:    user.ID,
		TokenHash: middleware.SessionTokenHash(claims.ID),
		UserAgent: db.ParseText(""),
		IpAddress: db.ParseText(""),
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(middleware.AccessTokenTTL), Valid: true},
	})
	if err != nil {
		return "", nil, err
	}
	return token, claims, nil
}

func parsePurpose(p string) (sqldb.OtpPurpose, bool) {
	switch strings.TrimSpace(p) {
	case "", "login":
		return sqldb.OtpPurposeLogin, true
	case "password_reset":
		return sqldb.OtpPurposePasswordReset, true
	}
	return "", false
}

func generateNumericCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// hashCode stores only a SHA-256 digest of the code, never the plaintext.
func hashCode(code string) string { return hashString(code) }

func hashString(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func constantTimeEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	var diff byte
	for i := 0; i < len(a); i++ {
		diff |= a[i] ^ b[i]
	}
	return diff == 0
}

func (s *Service) logOTPSendFailure(contact, reason string) {
	fmt.Printf("[auth] otp delivery to %s failed: %s\n", contact, reason)
}