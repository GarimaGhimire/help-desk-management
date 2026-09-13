package db

import (
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"
)

// ParseUUID converts a string UUID into a pgtype.UUID (zero value on error).
func ParseUUID(s string) pgtype.UUID {
	var u pgtype.UUID
	u.Scan(s)
	return u
}

// ParseText wraps a string into pgtype.Text.
func ParseText(s string) pgtype.Text {
	return pgtype.Text{String: s, Valid: s != ""}
}

// UUIDString renders a pgtype.UUID as its canonical string form ("" if null).
func UUIDString(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	b := u.Bytes
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}