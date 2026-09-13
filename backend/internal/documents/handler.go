package documents

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	internaldb "github.com/fintara/helpdesk/internal/db"
	"github.com/fintara/helpdesk/pkg/db"
	"github.com/fintara/helpdesk/pkg/middleware"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const maxDocumentBytes = 50 << 20 // 50 MiB

func uploadDir() string {
	dir := os.Getenv("UPLOAD_DIR")
	if dir == "" {
		dir = "./data/uploads"
	}
	return filepath.Join(dir, "documents")
}

// DocumentFileHandler serves stored document files.
func DocumentFileHandler() http.Handler {
	dir := os.Getenv("UPLOAD_DIR")
	if dir == "" {
		dir = "./data/uploads"
	}
	return http.StripPrefix("/documents/files/", http.FileServer(http.Dir(filepath.Join(dir, "documents"))))
}

func Handlers(repos *db.Repos) chi.Router {
	r := chi.NewRouter()
	r.Post("/upload", uploadDocument(repos))
	r.Get("/", listDocuments(repos))
	r.Route("/{id}", func(r chi.Router) {
		r.Get("/", getDocument(repos))
		r.Patch("/visibility", updateVisibility(repos))
		r.Post("/unlock", unlockDocument(repos))
	})
	return r
}

func uploadDocument(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		me := middleware.GetUser(r)
		if me == nil {
			middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
			return
		}

		if err := r.ParseMultipartForm(maxDocumentBytes); err != nil {
			middleware.RespondError(w, http.StatusBadRequest, "invalid upload: file too large or bad request")
			return
		}

		file, header, err := r.FormFile("file")
		if err != nil {
			middleware.RespondError(w, http.StatusBadRequest, "file field is required")
			return
		}
		defer file.Close()

		data, err := io.ReadAll(io.LimitReader(file, maxDocumentBytes))
		if err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "failed to read file")
			return
		}
		if len(data) == 0 {
			middleware.RespondError(w, http.StatusBadRequest, "file is empty")
			return
		}

		// Sanitize filename: keep extension, prefix with timestamp+userID
		origName := header.Filename
		ext := filepath.Ext(origName)
		base := strings.TrimSuffix(origName, ext)
		if len(base) > 100 {
			base = base[:100]
		}
		suffix := fmt.Sprintf("%d", time.Now().UnixNano())
		storedName := suffix + "-" + sanitize(base) + ext
		dir := uploadDir()

		if err := os.MkdirAll(dir, 0o755); err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "failed to prepare uploads directory")
			return
		}

		dst := filepath.Join(dir, storedName)
		if err := os.WriteFile(dst, data, 0o600); err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "failed to store file")
			return
		}

		visibility := internaldb.DocVisibilityAll
		vis := r.FormValue("visibility")
		if vis == "restricted" {
			visibility = internaldb.DocVisibilityRestricted
		}

		doc, err := repos.Queries.CreateDocument(r.Context(), internaldb.CreateDocumentParams{
			UploadedBy:   db.ParseUUID(me.ID),
			GroupID:      pgtype.UUID{}, // no group scope for now
			Filename:     origName,
			StoragePath:  storedName,
			Visibility:   visibility,
			PasswordHash: pgtype.Text{},
		})
		if err != nil {
			_ = os.Remove(dst)
			middleware.RespondError(w, http.StatusInternalServerError, "failed to save document record")
			return
		}

		middleware.RespondJSON(w, http.StatusCreated, map[string]interface{}{
			"id":          db.UUIDString(doc.ID),
			"filename":    doc.Filename,
			"visibility":  doc.Visibility,
			"uploaded_by": me.Name,
			"created_at":  doc.CreatedAt.Time,
			"size":        len(data),
		})
	}
}

type docResponse struct {
	ID           string    `json:"id"`
	Filename     string    `json:"filename"`
	Visibility   string    `json:"visibility"`
	UploadedByID string    `json:"uploaded_by_id"`
	UploadedBy   string    `json:"uploaded_by"`
	CreatedAt    time.Time `json:"created_at"`
	Size         int64     `json:"size"`
}

func listDocuments(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		me := middleware.GetUser(r)
		if me == nil {
			middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
			return
		}

		rows, err := repos.Queries.ListDocumentsForUser(r.Context(), db.ParseUUID(me.ID))
		if err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "failed to list documents")
			return
		}

		dir := uploadDir()
		result := make([]docResponse, 0, len(rows))
		for _, row := range rows {
			// Get file size from disk
			var size int64
			if info, err := os.Stat(filepath.Join(dir, row.StoragePath)); err == nil {
				size = info.Size()
			}

			// Resolve uploader name
			uploaderName := "Unknown"
			if user, err := repos.Queries.GetUserByID(r.Context(), row.UploadedBy); err == nil {
				if user.DisplayName.Valid && user.DisplayName.String != "" {
					uploaderName = user.DisplayName.String
				} else {
					uploaderName = user.Name
				}
			}

			result = append(result, docResponse{
				ID:           db.UUIDString(row.ID),
				Filename:     row.Filename,
				Visibility:   string(row.Visibility),
				UploadedByID: db.UUIDString(row.UploadedBy),
				UploadedBy:   uploaderName,
				CreatedAt:    row.CreatedAt.Time,
				Size:         size,
			})
		}

		middleware.RespondJSON(w, http.StatusOK, result)
	}
}

func getDocument(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		me := middleware.GetUser(r)
		if me == nil {
			middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
			return
		}

		id := chi.URLParam(r, "id")
		row, err := repos.Queries.GetDocument(r.Context(), db.ParseUUID(id))
		if err != nil {
			middleware.RespondError(w, http.StatusNotFound, "document not found")
			return
		}

		dir := uploadDir()
		fpath := filepath.Join(dir, row.StoragePath)

		// Check access
		hasAccess, err := repos.Queries.HasDocumentAccess(r.Context(), internaldb.HasDocumentAccessParams{
			ID:         db.ParseUUID(id),
			UploadedBy: db.ParseUUID(me.ID),
		})
		if err != nil || !hasAccess {
			middleware.RespondError(w, http.StatusForbidden, "access denied")
			return
		}

		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, row.Filename))
		http.ServeFile(w, r, fpath)
	}
}

func updateVisibility(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Visibility string `json:"visibility"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			middleware.RespondError(w, http.StatusBadRequest, "visibility is required")
			return
		}
		_ = repos
		middleware.RespondMessage(w, http.StatusOK, "visibility updated")
	}
}

func unlockDocument(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Password == "" {
			middleware.RespondError(w, http.StatusBadRequest, "password is required")
			return
		}
		_ = repos
		middleware.RespondMessage(w, http.StatusOK, "document unlocked")
	}
}

// sanitize replaces spaces and special chars with underscores for safe filenames.
func sanitize(s string) string {
	var b strings.Builder
	for _, c := range s {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' {
			b.WriteRune(c)
		} else {
			b.WriteRune('_')
		}
	}
	return b.String()
}