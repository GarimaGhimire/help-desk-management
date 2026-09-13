package documents

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	internaldb "github.com/fintara/helpdesk/internal/db"
	"github.com/fintara/helpdesk/pkg/db"
	"github.com/fintara/helpdesk/pkg/middleware"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type DocumentResponse struct {
	ID           string           `json:"id"`
	UploadedBy   string           `json:"uploaded_by"`
	UploaderName string           `json:"uploader_name"`
	GroupID      string           `json:"group_id,omitempty"`
	Filename     string           `json:"filename"`
	StoragePath  string           `json:"storage_path"`
	Visibility   string           `json:"visibility"`
	AllowedRoles []string         `json:"allowed_roles"`
	AllowedUsers []UserAccessInfo `json:"allowed_users"`
	CreatedAt    string           `json:"created_at"`
}

type UserAccessInfo struct {
	UserID   string `json:"user_id"`
	UserName string `json:"user_name"`
	Email    string `json:"email"`
}

func Handlers(repos *db.Repos) chi.Router {
	r := chi.NewRouter()
	r.Post("/upload", uploadDocument(repos))
	r.Get("/", listDocuments(repos))
	r.Route("/{id}", func(r chi.Router) {
		r.Get("/download", downloadDocument(repos))
		r.Patch("/visibility", updateVisibility(repos))
		r.Delete("/", deleteDocument(repos))
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

		if err := r.ParseMultipartForm(50 << 20); err != nil {
			middleware.RespondError(w, http.StatusBadRequest, "invalid upload or file exceeds 50MB")
			return
		}

		file, header, err := r.FormFile("file")
		if err != nil {
			middleware.RespondError(w, http.StatusBadRequest, "file is required")
			return
		}
		defer file.Close()

		visibility := r.FormValue("visibility")
		if visibility == "" {
			visibility = "all"
		}
		if visibility != "all" && visibility != "admins" && visibility != "restricted" && visibility != "custom" {
			middleware.RespondError(w, http.StatusBadRequest, "invalid visibility setting")
			return
		}

		var allowedRoles []string
		if rolesStr := r.FormValue("allowed_roles"); rolesStr != "" {
			_ = json.Unmarshal([]byte(rolesStr), &allowedRoles)
		}
		if allowedRoles == nil {
			allowedRoles = []string{}
		}

		var allowedUserIDs []string
		if usersStr := r.FormValue("allowed_users"); usersStr != "" {
			_ = json.Unmarshal([]byte(usersStr), &allowedUserIDs)
		}

		uploadDir := "./data/uploads/documents"
		if err := os.MkdirAll(uploadDir, 0755); err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "failed to create upload storage directory")
			return
		}

		filename := filepath.Base(header.Filename)
		out, err := os.CreateTemp(uploadDir, fmt.Sprintf("doc_%d_*_%s", time.Now().UnixNano(), filename))
		if err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "failed to store file")
			return
		}
		defer out.Close()

		if _, err := io.Copy(out, file); err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "failed to save file contents")
			return
		}

		actualStoragePath := out.Name()

		docParams := internaldb.CreateDocumentParams{
			UploadedBy:   db.ParseUUID(me.ID),
			GroupID:      pgtype.UUID{},
			Filename:     filename,
			StoragePath:  actualStoragePath,
			Visibility:   visibility,
			AllowedRoles: allowedRoles,
		}

		docRow, err := repos.Queries.CreateDocument(r.Context(), docParams)
		if err != nil {
			os.Remove(actualStoragePath)
			middleware.RespondError(w, http.StatusInternalServerError, "failed to save document record")
			return
		}

		docIDStr := db.UUIDString(docRow.ID)

		if visibility == "custom" && len(allowedUserIDs) > 0 {
			for _, uid := range allowedUserIDs {
				if uid != "" {
					_ = repos.Queries.GrantDocumentAccess(r.Context(), internaldb.GrantDocumentAccessParams{
						DocumentID: docRow.ID,
						UserID:     db.ParseUUID(uid),
					})
				}
			}
		}

		middleware.RespondJSON(w, http.StatusCreated, map[string]any{
			"message": "Document uploaded successfully",
			"id":      docIDStr,
		})
	}
}

func listDocuments(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		me := middleware.GetUser(r)
		if me == nil {
			middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
			return
		}

		docs, err := repos.Queries.ListAllDocuments(r.Context())
		if err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "failed to list documents")
			return
		}

		result := []DocumentResponse{}
		isAdmin := me.Role == "org_admin" || me.Role == "staff_admin" || me.Role == "superadmin"

		for _, d := range docs {
			uploaderIDStr := db.UUIDString(d.UploadedBy)
			docIDStr := db.UUIDString(d.ID)

			// Visibility Check
			canAccess := false
			if uploaderIDStr == me.ID {
				canAccess = true
			} else {
				switch d.Visibility {
				case "all":
					canAccess = true
				case "admins":
					if isAdmin {
						canAccess = true
					}
				case "restricted":
					// strictly only uploader, not even admins!
					canAccess = false
				case "custom":
					// Check allowed roles
					for _, role := range d.AllowedRoles {
						if role == me.Role {
							canAccess = true
							break
						}
					}
					// Check custom allowed users if not yet matched by role
					if !canAccess {
						accessList, _ := repos.Queries.GetDocumentAccessList(r.Context(), d.ID)
						for _, u := range accessList {
							if db.UUIDString(u.UserID) == me.ID {
								canAccess = true
								break
							}
						}
					}
				}
			}

			if !canAccess {
				continue
			}

			accessList, _ := repos.Queries.GetDocumentAccessList(r.Context(), d.ID)
			allowedUsers := []UserAccessInfo{}
			for _, u := range accessList {
				allowedUsers = append(allowedUsers, UserAccessInfo{
					UserID:   db.UUIDString(u.UserID),
					UserName: u.UserName,
					Email:    u.Email.String,
				})
			}

			allowedRoles := d.AllowedRoles
			if allowedRoles == nil {
				allowedRoles = []string{}
			}

			result = append(result, DocumentResponse{
				ID:           docIDStr,
				UploadedBy:   uploaderIDStr,
				UploaderName: d.UploaderName,
				Filename:     d.Filename,
				StoragePath:  d.StoragePath,
				Visibility:   d.Visibility,
				AllowedRoles: allowedRoles,
				AllowedUsers: allowedUsers,
				CreatedAt:    d.CreatedAt.Time.Format("2006-01-02 15:04:05"),
			})
		}

		middleware.RespondJSON(w, http.StatusOK, result)
	}
}

func downloadDocument(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		me := middleware.GetUser(r)
		if me == nil {
			middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
			return
		}

		docIDStr := chi.URLParam(r, "id")
		doc, err := repos.Queries.GetDocument(r.Context(), db.ParseUUID(docIDStr))
		if err != nil {
			middleware.RespondError(w, http.StatusNotFound, "document not found")
			return
		}

		uploaderIDStr := db.UUIDString(doc.UploadedBy)
		isAdmin := me.Role == "org_admin" || me.Role == "staff_admin" || me.Role == "superadmin"

		canAccess := false
		if uploaderIDStr == me.ID {
			canAccess = true
		} else {
			switch doc.Visibility {
			case "all":
				canAccess = true
			case "admins":
				if isAdmin {
					canAccess = true
				}
			case "restricted":
				// Strictly only uploader, not even admins!
				canAccess = false
			case "custom":
				for _, role := range doc.AllowedRoles {
					if role == me.Role {
						canAccess = true
						break
					}
				}
				if !canAccess {
					accessList, _ := repos.Queries.GetDocumentAccessList(r.Context(), doc.ID)
					for _, u := range accessList {
						if db.UUIDString(u.UserID) == me.ID {
							canAccess = true
							break
						}
					}
				}
			}
		}

		if !canAccess {
			middleware.RespondError(w, http.StatusForbidden, "you do not have access to view or download this document")
			return
		}

		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", doc.Filename))
		http.ServeFile(w, r, doc.StoragePath)
	}
}

func updateVisibility(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		me := middleware.GetUser(r)
		if me == nil {
			middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
			return
		}

		docIDStr := chi.URLParam(r, "id")
		doc, err := repos.Queries.GetDocument(r.Context(), db.ParseUUID(docIDStr))
		if err != nil {
			middleware.RespondError(w, http.StatusNotFound, "document not found")
			return
		}

		uploaderIDStr := db.UUIDString(doc.UploadedBy)
		isAdmin := me.Role == "org_admin" || me.Role == "staff_admin" || me.Role == "superadmin"
		if uploaderIDStr != me.ID && !isAdmin {
			middleware.RespondError(w, http.StatusForbidden, "only the uploader or admins can change document settings")
			return
		}

		var req struct {
			Visibility   string   `json:"visibility"`
			AllowedRoles []string `json:"allowed_roles"`
			AllowedUsers []string `json:"allowed_users"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			middleware.RespondError(w, http.StatusBadRequest, "invalid request body")
			return
		}

		if req.Visibility != "all" && req.Visibility != "admins" && req.Visibility != "restricted" && req.Visibility != "custom" {
			middleware.RespondError(w, http.StatusBadRequest, "invalid visibility setting")
			return
		}

		if req.AllowedRoles == nil {
			req.AllowedRoles = []string{}
		}

		_, err = repos.Queries.UpdateDocumentVisibility(r.Context(), internaldb.UpdateDocumentVisibilityParams{
			ID:           doc.ID,
			Visibility:   req.Visibility,
			AllowedRoles: req.AllowedRoles,
		})
		if err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "failed to update visibility")
			return
		}

		// Update document_access list
		_ = repos.Queries.ClearDocumentAccessList(r.Context(), doc.ID)
		if req.Visibility == "custom" && len(req.AllowedUsers) > 0 {
			for _, uid := range req.AllowedUsers {
				if uid != "" {
					_ = repos.Queries.GrantDocumentAccess(r.Context(), internaldb.GrantDocumentAccessParams{
						DocumentID: doc.ID,
						UserID:     db.ParseUUID(uid),
					})
				}
			}
		}

		middleware.RespondMessage(w, http.StatusOK, "document access settings updated")
	}
}

func deleteDocument(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		me := middleware.GetUser(r)
		if me == nil {
			middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
			return
		}

		docIDStr := chi.URLParam(r, "id")
		doc, err := repos.Queries.GetDocument(r.Context(), db.ParseUUID(docIDStr))
		if err != nil {
			middleware.RespondError(w, http.StatusNotFound, "document not found")
			return
		}

		uploaderIDStr := db.UUIDString(doc.UploadedBy)
		isAdmin := me.Role == "org_admin" || me.Role == "staff_admin" || me.Role == "superadmin"
		if uploaderIDStr != me.ID && !isAdmin {
			middleware.RespondError(w, http.StatusForbidden, "only the uploader or admins can delete this document")
			return
		}

		os.Remove(doc.StoragePath)
		_ = repos.Queries.ClearDocumentAccessList(r.Context(), doc.ID)
		if err := repos.Queries.DeleteDocument(r.Context(), doc.ID); err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "failed to delete document record")
			return
		}

		middleware.RespondMessage(w, http.StatusOK, "document deleted successfully")
	}
}