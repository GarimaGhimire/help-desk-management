package search

import (
	"net/http"
	"time"

	sqldb "github.com/fintara/helpdesk/internal/db"
	"github.com/fintara/helpdesk/pkg/db"
	"github.com/fintara/helpdesk/pkg/middleware"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const searchLimit = 25

func Handlers(repos *db.Repos) chi.Router {
	r := chi.NewRouter()
	r.Get("/", globalSearch(repos))
	return r
}

func globalSearch(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		me := middleware.GetUser(r)
		if me == nil {
			middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
			return
		}

		q := r.URL.Query().Get("q")
		if q == "" {
			middleware.RespondJSON(w, http.StatusOK, emptyResults(q))
			return
		}

		orgScope := orgScopeFor(me)
		userScope := userScopeFor(me)

		users, _ := repos.Queries.GlobalSearchUsers(r.Context(), sqldb.GlobalSearchUsersParams{
			Column1:        orgScope,
			PlaintoTsquery: q,
		})
		messages, _ := repos.Queries.GlobalSearchMessages(r.Context(), sqldb.GlobalSearchMessagesParams{
			Column1:        orgScope,
			Column2:        userScope,
			PlaintoTsquery: q,
			Limit:          searchLimit,
		})
		documents, _ := repos.Queries.GlobalSearchDocuments(r.Context(), sqldb.GlobalSearchDocumentsParams{
			Column1:        orgScope,
			Column2:        userScope,
			PlaintoTsquery: q,
			Limit:          searchLimit,
		})

		middleware.RespondJSON(w, http.StatusOK, map[string]interface{}{
			"query":     q,
			"users":     serializeUsers(users),
			"groups":    []interface{}{},
			"messages":  serializeMessages(messages),
			"documents": serializeDocuments(documents),
		})
	}
}

// orgScopeFor returns null for superadmins (all orgs); everyone else is
// hard-scoped to their own org.
func orgScopeFor(me *middleware.AuthUser) pgtype.UUID {
	if me.Role == "superadmin" {
		return pgtype.UUID{}
	}
	return db.ParseUUID(me.OrgID)
}

// userScopeFor restricts message/document results to the caller's group
// memberships. Admins manage all groups and pass null ("any in scope").
func userScopeFor(me *middleware.AuthUser) pgtype.UUID {
	if me.Role == "org_member" {
		return db.ParseUUID(me.ID)
	}
	return pgtype.UUID{}
}

func emptyResults(q string) map[string]interface{} {
	return map[string]interface{}{
		"query":     q,
		"users":     []interface{}{},
		"groups":    []interface{}{},
		"messages":  []interface{}{},
		"documents": []interface{}{},
	}
}

func serializeUsers(rows []sqldb.GlobalSearchUsersRow) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(rows))
	for _, u := range rows {
		var email, phone, orgID *string
		if u.Email.Valid {
			e := u.Email.String
			email = &e
		}
		if u.Phone.Valid {
			p := u.Phone.String
			phone = &p
		}
		if u.OrgID.Valid {
			o := db.UUIDString(u.OrgID)
			orgID = &o
		}
		out = append(out, map[string]interface{}{
			"id":         db.UUIDString(u.ID),
			"org_id":     orgID,
			"name":       u.Name,
			"email":      email,
			"phone":      phone,
			"role":       string(u.Role),
			"is_active":  u.IsActive,
			"created_at": u.CreatedAt.Time.UTC().Format(time.RFC3339),
		})
	}
	return out
}

func serializeMessages(rows []sqldb.GlobalSearchMessagesRow) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(rows))
	for _, m := range rows {
		out = append(out, map[string]interface{}{
			"id":        db.UUIDString(m.ID),
			"group_id":  db.UUIDString(m.GroupID),
			"sender_id": db.UUIDString(m.SenderID),
			"content":   m.Content,
			"created_at": m.CreatedAt.Time.UTC().Format(time.RFC3339),
		})
	}
	return out
}

func serializeDocuments(rows []sqldb.GlobalSearchDocumentsRow) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(rows))
	for _, d := range rows {
		var groupID *string
		if d.GroupID.Valid {
			g := db.UUIDString(d.GroupID)
			groupID = &g
		}
		out = append(out, map[string]interface{}{
			"id":         db.UUIDString(d.ID),
			"group_id":   groupID,
			"uploaded_by": db.UUIDString(d.UploadedBy),
			"filename":   d.Filename,
			"visibility": string(d.Visibility),
			"created_at": d.CreatedAt.Time.UTC().Format(time.RFC3339),
		})
	}
	return out
}