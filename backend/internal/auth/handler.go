package auth

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/fintara/helpdesk/pkg/db"
	"github.com/fintara/helpdesk/pkg/middleware"
	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
)

func Handlers(repos *db.Repos) chi.Router {
	r := chi.NewRouter()
	r.Post("/request-otp", requestOTP(repos))
	r.Post("/verify-otp", verifyOTP(repos))
	return r
}

func requestOTP(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Contact string `json:"contact"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Contact == "" {
			middleware.RespondError(w, http.StatusBadRequest, "contact is required")
			return
		}

		code := generateOTP()

		// DEV OTP delivery: log to console.
		// Replace with Twilio (SMS) or SES/SendGrid (email) in production.
		log.Printf("[OTP] dev delivery → contact=%s code=%s", req.Contact, code)

		_ = repos
		middleware.RespondMessage(w, http.StatusAccepted, "otp sent")
	}
}

func verifyOTP(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Contact string `json:"contact"`
			Code    string `json:"code"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Contact == "" || req.Code == "" {
			middleware.RespondError(w, http.StatusBadRequest, "contact and code are required")
			return
		}

		// TODO: look up user by contact, verify OTP code against otp_codes table.
		// Stubbed for Phase 0 — accepts any code and returns token for "user-1".
		userID := "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"

		token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
			"sub": userID,
			"exp": time.Now().Add(24 * time.Hour).Unix(),
		})
		tokenStr, err := token.SignedString([]byte(middleware.JWTSecret()))
		if err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "failed to generate token")
			return
		}

		middleware.RespondJSON(w, http.StatusOK, map[string]string{"token": tokenStr})
	}
}

func generateOTP() string {
	b := make([]byte, 4)
	rand.Read(b)
	return hex.EncodeToString(b)[:6]
}