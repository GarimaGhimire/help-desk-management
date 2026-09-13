package audit

import (
	"encoding/json"
	"net/http"

	sqldb "github.com/fintara/helpdesk/internal/db"
	"github.com/fintara/helpdesk/pkg/db"
	"github.com/fintara/helpdesk/pkg/middleware"
	"github.com/jackc/pgx/v5/pgtype"
)

// Log records an auditable action. Failures are logged but never block the
// request the audit entry belongs to (a failed audit read is worse than no log).
func Log(r *http.Request, repos *db.Repos, action, targetType string, targetID pgtype.UUID, metadata any) {
	actor := middleware.GetUser(r)
	if actor == nil {
		return
	}

	var org pgtype.UUID
	var meta []byte
	if actor.OrgID != "" {
		org.Scan(actor.OrgID)
	}
	if metadata != nil {
		meta, _ = json.Marshal(metadata)
	}

	params := sqldb.CreateAuditLogParams{
		OrgID:      org,
		ActorID:    pgtype.UUID{},
		Action:     action,
		TargetType: db.ParseText(targetType),
		TargetID:   targetID,
		Metadata:   meta,
		IpAddress:  db.ParseText(clientIP(r)),
	}
	params.ActorID.Scan(actor.ID)

	_, err := repos.Queries.CreateAuditLog(r.Context(), params)
	if err != nil {
		// swallow: audit must never take down the primary operation
	}
}

// clientIP returns the original client IP, honoring X-Forwarded-For when the
// app runs behind a reverse proxy.
func clientIP(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		parts := splitCSV(fwd)
		if len(parts) > 0 {
			return parts[0]
		}
	}
	host, _, err := splitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func splitCSV(s string) []string {
	var out []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == ',' {
			out = append(out, trim(s[start:i]))
			start = i + 1
		}
	}
	out = append(out, trim(s[start:]))
	return out
}

func trim(s string) string {
	start, end := 0, len(s)
	for start < end && (s[start] == ' ' || s[start] == '\t') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t') {
		end--
	}
	return s[start:end]
}

func splitHostPort(addr string) (host, port string, err error) {
	// minimal net.SplitHostPort wrapper for the common `ip:port` form
	i := 0
	for i < len(addr) && addr[i] != ':' {
		i++
	}
	if i == len(addr) {
		return addr, "", nil
	}
	return addr[:i], addr[i+1:], nil
}