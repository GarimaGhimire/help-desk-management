package middleware

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

const UserIDKey contextKey = "user_id"

func Auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tokenStr := ""

		// Bearer header (standard)
		if header := r.Header.Get("Authorization"); header != "" && strings.HasPrefix(header, "Bearer ") {
			tokenStr = strings.TrimPrefix(header, "Bearer ")
		}

		// Query param fallback for WebSocket (browser WS API can't set headers)
		if tokenStr == "" {
			tokenStr = r.URL.Query().Get("token")
		}

		if tokenStr == "" {
			RespondError(w, http.StatusUnauthorized, "missing authorization")
			return
		}

		token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
			return []byte(JWTSecret()), nil
		})
		if err != nil || !token.Valid {
			RespondError(w, http.StatusUnauthorized, "invalid token")
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			RespondError(w, http.StatusUnauthorized, "invalid claims")
			return
		}

		userID, ok := claims["sub"].(string)
		if !ok {
			RespondError(w, http.StatusUnauthorized, "invalid subject")
			return
		}

		ctx := context.WithValue(r.Context(), UserIDKey, userID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func JWTSecret() string {
	if secret := os.Getenv("JWT_SECRET"); secret != "" {
		return secret
	}
	return "dev-secret-change-in-prod"
}

func GetUserID(r *http.Request) string {
	if uid, ok := r.Context().Value(UserIDKey).(string); ok {
		return uid
	}
	return ""
}

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