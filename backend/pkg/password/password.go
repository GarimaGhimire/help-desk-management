package password

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"unicode"

	"golang.org/x/crypto/bcrypt"
)

const bcryptCost = 12

// Alpha-num alphabet excluding ambiguous characters (0, O, 1, l, I).
const safeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*"

// ValidatePolicy enforces a minimum password strength:
// at least 10 chars, one uppercase, one lowercase, one digit, one special.
func ValidatePolicy(pw string) error {
	if len(pw) < 10 {
		return errors.New("password must be at least 10 characters long")
	}

	var hasUpper, hasLower, hasDigit, hasSpecial bool
	for _, r := range pw {
		switch {
		case unicode.IsUpper(r):
			hasUpper = true
		case unicode.IsLower(r):
			hasLower = true
		case unicode.IsDigit(r):
			hasDigit = true
		case unicode.IsSpace(r):
			return errors.New("password must not contain spaces")
		case !unicode.IsLetter(r) && !unicode.IsDigit(r):
			hasSpecial = true
		}
	}

	if !hasUpper {
		return errors.New("password must contain an uppercase letter")
	}
	if !hasLower {
		return errors.New("password must contain a lowercase letter")
	}
	if !hasDigit {
		return errors.New("password must contain a number")
	}
	if !hasSpecial {
		return errors.New("password must contain a special character")
	}
	return nil
}

// Hash returns a bcrypt hash of the password.
func Hash(pw string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pw), bcryptCost)
	if err != nil {
		return "", fmt.Errorf("hash password: %w", err)
	}
	return string(b), nil
}

// Compare reports whether the plaintext password matches the stored hash.
func Compare(hash, pw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil
}

// GenerateTempPassword creates a cryptographically secure 16-char password
// from the safe alphabet.
func GenerateTempPassword() (string, error) {
	const length = 16
	buf := make([]byte, length)
	for i := range buf {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(safeAlphabet))))
		if err != nil {
			return "", fmt.Errorf("generate random password: %w", err)
		}
		buf[i] = safeAlphabet[n.Int64()]
	}
	return string(buf), nil
}