package profile

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	sqldb "github.com/fintara/helpdesk/internal/db"
	"github.com/fintara/helpdesk/pkg/audit"
	"github.com/fintara/helpdesk/pkg/db"
	"github.com/fintara/helpdesk/pkg/middleware"
	"github.com/go-chi/chi/v5"
)

const maxAvatarBytes = 2 << 20 // 2 MiB

type Service struct {
	repos      *db.Repos
	uploadDir  string
	publicPath string
}

// Handlers mounts the current user's own profile endpoints under /me. Every
// route is scoped to the authenticated user (from the auth middleware).
func Handlers(repos *db.Repos) chi.Router {
	s := &Service{repos: repos}
	s.uploadDir = os.Getenv("UPLOAD_DIR")
	s.publicPath = "/avatars"
	if s.uploadDir == "" {
		s.uploadDir = "./data/uploads"
	}

	r := chi.NewRouter()
	r.Get("/", s.get)
	r.Patch("/", s.update)
	r.Post("/avatar", s.uploadAvatar)
	r.Delete("/avatar", s.deleteAvatar)
	r.Post("/deactivate", s.deactivate)
	return r
}

// AvatarDir returns the absolute directory where avatar files are stored.
func (s *Service) AvatarDir() string {
	return filepath.Join(s.uploadDir, "avatars")
}

// AvatarHandler serves stored avatar images under /avatars/ directly from the database.
func AvatarHandler(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		filename := chi.URLParam(r, "filename")
		if filename == "" {
			filename = filepath.Base(r.URL.Path)
		}
		filename = filepath.Base(filename)
		if filename == "" || filename == "." || filename == "/" {
			http.NotFound(w, r)
			return
		}

		var contentType string
		var data []byte
		err := repos.Pool.QueryRow(r.Context(),
			`SELECT content_type, file_data FROM avatars WHERE filename = $1 LIMIT 1`,
			filename,
		).Scan(&contentType, &data)
		if err != nil {
			http.NotFound(w, r)
			return
		}

		if contentType == "" {
			contentType = "application/octet-stream"
		}
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Content-Length", strconv.Itoa(len(data)))
		w.Header().Set("Cache-Control", "public, max-age=86400")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		http.ServeContent(w, r, filename, time.Time{}, bytes.NewReader(data))
	}
}

func (s *Service) get(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	respondProfile(w, s, r, me)
}

func (s *Service) update(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var req struct {
		DisplayName *string `json:"display_name"`
		Phone       *string `json:"phone"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.RespondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.DisplayName == nil && req.Phone == nil {
		middleware.RespondError(w, http.StatusBadRequest, "nothing to update")
		return
	}

	updated := false
	if req.DisplayName != nil {
		name := strings.TrimSpace(*req.DisplayName)
		if name == "" || len(name) > 255 {
			middleware.RespondError(w, http.StatusBadRequest, "display_name must be 1-255 characters")
			return
		}
		row, err := s.repos.Queries.UpdateUserProfile(r.Context(), sqldb.UpdateUserProfileParams{
			ID:          db.ParseUUID(me.ID),
			DisplayName: db.ParseText(name),
		})
		if err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "failed to update profile")
			return
		}
		me.DisplayName = row.DisplayName.String
		updated = true
	}

	if req.Phone != nil {
		phone := strings.TrimSpace(*req.Phone)
		if len(phone) > 20 {
			middleware.RespondError(w, http.StatusBadRequest, "phone must be at most 20 characters")
			return
		}
		if phone != me.Phone {
			if phone != "" {
				if taken, err := s.repos.Queries.IsPhoneTaken(r.Context(), db.ParseText(phone)); err == nil && taken {
					middleware.RespondError(w, http.StatusConflict, "phone already in use")
					return
				}
			}
			row, err := s.repos.Queries.UpdateUserPhone(r.Context(), sqldb.UpdateUserPhoneParams{
				ID:    db.ParseUUID(me.ID),
				Phone: db.ParseText(phone),
			})
			if err != nil {
				middleware.RespondError(w, http.StatusInternalServerError, "failed to update phone")
				return
			}
			me.Phone = row.Phone.String
			updated = true
		}
	}

	if !updated {
		middleware.RespondError(w, http.StatusBadRequest, "nothing to update")
		return
	}
	respondProfile(w, s, r, me)
}

func (s *Service) deleteAvatar(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	if me.AvatarURL != "" {
		name := filepath.Base(me.AvatarURL)
		if name != "." && name != "/" && !strings.Contains(name, "/") {
			_, _ = s.repos.Pool.Exec(r.Context(), `DELETE FROM avatars WHERE filename = $1`, name)
		}
	}

	row, err := s.repos.Queries.ClearUserAvatar(r.Context(), db.ParseUUID(me.ID))
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to remove avatar")
		return
	}

	me.AvatarURL = row.AvatarUrl.String
	respondProfile(w, s, r, me)
}

func (s *Service) deactivate(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	// A self-deactivated platform superadmin would lock out the operator.
	if me.Role == "superadmin" {
		middleware.RespondError(w, http.StatusBadRequest, "a platform superadmin cannot deactivate their own account")
		return
	}
	// An org must always keep at least one active admin.
	if me.Role == "org_admin" && me.OrgID != "" {
		count, err := s.repos.Queries.CountActiveOrgAdmins(r.Context(), db.ParseUUID(me.OrgID))
		if err == nil && count <= 1 {
			middleware.RespondError(w, http.StatusBadRequest, "cannot deactivate the last org admin of your organization")
			return
		}
	}

	row, err := s.repos.Queries.DeactivateUser(r.Context(), db.ParseUUID(me.ID))
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to deactivate account")
		return
	}

	// Kill every active session so the deactivation takes effect immediately.
	_ = s.repos.Queries.RevokeAllUserSessions(r.Context(), row.ID)
	audit.Log(r, s.repos, "user.deactivate", "user", row.ID, map[string]interface{}{
		"is_active": row.IsActive,
	})

	middleware.RespondMessage(w, http.StatusOK, "account deactivated")
}

func (s *Service) uploadAvatar(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	if err := r.ParseMultipartForm(maxAvatarBytes); err != nil {
		middleware.RespondError(w, http.StatusBadRequest, "avatar upload must be a single file under 2MB")
		return
	}
	file, _, err := r.FormFile("avatar")
	if err != nil {
		middleware.RespondError(w, http.StatusBadRequest, "avatar file is required")
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxAvatarBytes))
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to read upload")
		return
	}
	if len(data) == 0 {
		middleware.RespondError(w, http.StatusBadRequest, "avatar file is empty")
		return
	}

	detectedType := http.DetectContentType(data)
	ext, ok := imageExt(detectedType)
	if !ok {
		middleware.RespondError(w, http.StatusBadRequest, "only png, jpeg, webp or gif images are allowed")
		return
	}

	suffix, err := randomSuffix(6)
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to name upload")
		return
	}

	filename := me.ID + "-" + suffix + ext

	// Save directly to the database in avatars table
	_, err = s.repos.Pool.Exec(r.Context(), `
		INSERT INTO avatars (filename, user_id, content_type, file_data)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (filename) DO UPDATE SET file_data = EXCLUDED.file_data, content_type = EXCLUDED.content_type
	`, filename, db.ParseUUID(me.ID), detectedType, data)
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to store avatar in database")
		return
	}

	// Remove previous avatar record if any
	if me.AvatarURL != "" {
		oldFilename := filepath.Base(me.AvatarURL)
		if oldFilename != "" && oldFilename != filename {
			_, _ = s.repos.Pool.Exec(r.Context(), `DELETE FROM avatars WHERE filename = $1`, oldFilename)
		}
	}

	url := s.publicPath + "/" + filename

	row, err := s.repos.Queries.UpdateUserAvatar(r.Context(), sqldb.UpdateUserAvatarParams{
		ID:        db.ParseUUID(me.ID),
		AvatarUrl: db.ParseText(url),
	})
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to update avatar")
		return
	}

	me.AvatarURL = row.AvatarUrl.String
	respondProfile(w, s, r, me)
}

func respondProfile(w http.ResponseWriter, s *Service, r *http.Request, me *middleware.AuthUser) {
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
		"created_at":           me.CreatedAt.Format(time.RFC3339),
	}
	if me.LastLoginAt != nil {
		resp["last_login_at"] = me.LastLoginAt.Format(time.RFC3339)
	}
	if me.OrgID != "" {
		if org, err := s.repos.Queries.GetOrganization(r.Context(), db.ParseUUID(me.OrgID)); err == nil {
			resp["org"] = map[string]interface{}{
				"id":        db.UUIDString(org.ID),
				"name":      org.Name,
				"slug":      org.Slug,
				"is_active": org.IsActive,
			}
			if !org.IsActive {
				resp["org_suspended"] = true
			}
		}
	}
	middleware.RespondJSON(w, http.StatusOK, resp)
}

func imageExt(contentType string) (string, bool) {
	switch contentType {
	case "image/png":
		return ".png", true
	case "image/jpeg":
		return ".jpg", true
	case "image/webp":
		return ".webp", true
	case "image/gif":
		return ".gif", true
	}
	return "", false
}

func randomSuffix(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
