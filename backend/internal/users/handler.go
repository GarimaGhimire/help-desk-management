package users

import (
	"encoding/json"
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

type Service struct {
	repos *db.Repos
	mail  *mailer.Mailer
}

func Handlers(repos *db.Repos, mail *mailer.Mailer) chi.Router {
	s := &Service{repos: repos, mail: mail}

	r := chi.NewRouter()
	r.Get("/", s.listUsers)
	r.Get("/search", s.searchUsers)
	r.Get("/{id}", s.getUser)

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequireRole("org_admin", "superadmin"))
		r.Post("/", s.createUser)
		r.Patch("/{id}", s.updateUser)
		r.Post("/{id}/reset-password", s.resetPassword)
	})
	return r
}

// ------------------------------ read ------------------------------

func (s *Service) listUsers(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	rows, err := s.repos.Queries.ListUsersByOrg(r.Context(), sqldb.ListUsersByOrgParams{
		Column1: orgScope(me),
		Limit:   200,
	})
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to list users")
		return
	}

	out := make([]userResponse, 0, len(rows))
	for _, row := range rows {
		out = append(out, serializeUser(row.ID, row.OrgID, row.Name, row.DisplayName, row.Email, row.Phone, row.AvatarUrl, row.Role, row.LanguagePref, row.IsActive, row.MustChangePassword, row.LastLoginAt, row.CreatedAt))
	}
	middleware.RespondJSON(w, http.StatusOK, out)
}

func (s *Service) searchUsers(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		middleware.RespondJSON(w, http.StatusOK, []userResponse{})
		return
	}

	rows, err := s.repos.Queries.SearchUsersByOrg(r.Context(), sqldb.SearchUsersByOrgParams{
		Column1:        orgScope(me),
		PlaintoTsquery: q,
		Limit:          50,
	})
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "search failed")
		return
	}

	out := make([]userResponse, 0, len(rows))
	for _, row := range rows {
		out = append(out, serializeUser(row.ID, row.OrgID, row.Name, row.DisplayName, row.Email, row.Phone, row.AvatarUrl, row.Role, row.LanguagePref, row.IsActive, row.MustChangePassword, row.LastLoginAt, row.CreatedAt))
	}
	middleware.RespondJSON(w, http.StatusOK, out)
}

func (s *Service) getUser(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	row, err := s.repos.Queries.GetUserByID(r.Context(), db.ParseUUID(chi.URLParam(r, "id")))
	if err != nil {
		middleware.RespondError(w, http.StatusNotFound, "user not found")
		return
	}

	// Cross-tenant guard: only superadmins may read users outside their org.
	if me.Role != "superadmin" {
		if db.UUIDString(row.OrgID) != me.OrgID {
			middleware.RespondError(w, http.StatusNotFound, "user not found")
			return
		}
	}

	middleware.RespondJSON(w, http.StatusOK, serializeUser(row.ID, row.OrgID, row.Name, row.DisplayName, row.Email, row.Phone, row.AvatarUrl, row.Role, row.LanguagePref, row.IsActive, row.MustChangePassword, row.LastLoginAt, row.CreatedAt))
}

// ------------------------------ admin writes ------------------------------

func (s *Service) createUser(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var req struct {
		Name         string `json:"name"`
		Email        string `json:"email"`
		Phone        string `json:"phone"`
		Role         string `json:"role"`
		LanguagePref string `json:"language_pref"`
		OrgID        string `json:"org_id"`
		Password     string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.RespondError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))

	if req.Name == "" || (req.Email == "" && req.Phone == "") {
		middleware.RespondError(w, http.StatusBadRequest, "name and at least one of email/phone are required")
		return
	}

	// Resolve target org.
	var orgID pgtype.UUID
	switch me.Role {
	case "superadmin":
		if req.OrgID == "" {
			middleware.RespondError(w, http.StatusBadRequest, "org_id is required for platform admins")
			return
		}
		orgID = db.ParseUUID(req.OrgID)
		if !orgID.Valid {
			middleware.RespondError(w, http.StatusBadRequest, "invalid org_id")
			return
		}
	case "org_admin":
		orgID = db.ParseUUID(me.OrgID)
	}

	// Only a superadmin may grant the org_admin role.
	role := sqldb.UserRoleOrgMember
	switch req.Role {
	case "", "org_member":
	case "org_admin":
		if me.Role != "superadmin" {
			middleware.RespondError(w, http.StatusForbidden, "only a platform superadmin can grant the org_admin role")
			return
		}
		role = sqldb.UserRoleOrgAdmin
	default:
		middleware.RespondError(w, http.StatusBadRequest, "role must be org_member or org_admin")
		return
	}

	lang := strings.TrimSpace(req.LanguagePref)
	if lang == "" {
		lang = "en"
	}
	if lang != "en" && lang != "ne" {
		middleware.RespondError(w, http.StatusBadRequest, "language_pref must be en or ne")
		return
	}

	// Enforce the organization's staff quota.
	if orgID.Valid {
		org, err := s.repos.Queries.GetOrganization(r.Context(), orgID)
		if err != nil {
			middleware.RespondError(w, http.StatusNotFound, "organization not found")
			return
		}
		if org.StaffLimit.Valid {
			count, err := s.repos.Queries.CountUsersByOrg(r.Context(), orgID)
			if err != nil {
				middleware.RespondError(w, http.StatusInternalServerError, "failed to check staff limit")
				return
			}
			if count >= int64(org.StaffLimit.Int32) {
				middleware.RespondError(w, http.StatusForbidden, "this organization has reached its staff limit")
				return
			}
		}
	}

	if taken, err := s.repos.Queries.IsEmailTaken(r.Context(), db.ParseText(req.Email)); err == nil && taken {
		middleware.RespondError(w, http.StatusConflict, "email already in use")
		return
	}
	if taken, err := s.repos.Queries.IsPhoneTaken(r.Context(), db.ParseText(req.Phone)); err == nil && taken {
		middleware.RespondError(w, http.StatusConflict, "phone already in use")
		return
	}

	// When a password is supplied (e.g. a superadmin onboarding an org admin)
	// it is used as-is so no temp password is emailed and the account can
	// sign in immediately. Otherwise a temp password is generated and emailed.
	var hashed string
	mustChange := true
	mailPassword := ""
	if req.Password != "" {
		if err := password.ValidatePolicy(req.Password); err != nil {
			middleware.RespondError(w, http.StatusBadRequest, err.Error())
			return
		}
		var err error
		hashed, err = password.Hash(req.Password)
		if err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "failed to hash password")
			return
		}
		mustChange = false
	} else {
		tempPw, err := password.GenerateTempPassword()
		if err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "failed to generate password")
			return
		}
		hashed, err = password.Hash(tempPw)
		if err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "failed to hash password")
			return
		}
		mailPassword = tempPw
	}

	user, err := s.repos.Queries.CreateUser(r.Context(), sqldb.CreateUserParams{
		Name:               req.Name,
		Email:              db.ParseText(req.Email),
		Phone:              db.ParseText(req.Phone),
		PasswordHash:       db.ParseText(hashed),
		Role:               role,
		OrgID:              orgID,
		LanguagePref:       lang,
		InvitedBy:          db.ParseUUID(me.ID),
		MustChangePassword: mustChange,
	})
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to create account")
		return
	}

	if req.Email != "" && mailPassword != "" {
		_ = s.mail.SendAccountCreated(req.Email, req.Name, mailPassword)
	}

	passwordMode := "temp_emailed"
	if !mustChange {
		passwordMode = "self_set"
	}
	audit.Log(r, s.repos, "user.create", "user", user.ID, map[string]interface{}{
		"role":     req.Role,
		"password": passwordMode,
	})

	middleware.RespondJSON(w, http.StatusCreated, serializeUser(user.ID, user.OrgID, user.Name, user.DisplayName, user.Email, user.Phone, user.AvatarUrl, user.Role, user.LanguagePref, user.IsActive, user.MustChangePassword, user.LastLoginAt, user.CreatedAt))
}

func (s *Service) updateUser(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	targetID := chi.URLParam(r, "id")

	row, err := s.repos.Queries.GetUserByID(r.Context(), db.ParseUUID(targetID))
	if err != nil {
		middleware.RespondError(w, http.StatusNotFound, "user not found")
		return
	}

	// Cross-tenant guard.
	if me.Role != "superadmin" && db.UUIDString(row.OrgID) != me.OrgID {
		middleware.RespondError(w, http.StatusNotFound, "user not found")
		return
	}
	// An org_admin may not modify another org_admin (superadmin only).
	if me.Role != "superadmin" && string(row.Role) == "org_admin" {
		middleware.RespondError(w, http.StatusForbidden, "only a platform superadmin can modify org_admin accounts")
		return
	}

	var req struct {
		Name         *string `json:"name"`
		Email        *string `json:"email"`
		Phone        *string `json:"phone"`
		Role         *string `json:"role"`
		LanguagePref *string `json:"language_pref"`
		IsActive     *bool   `json:"is_active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.RespondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	name := row.Name
	if req.Name != nil {
		name = strings.TrimSpace(*req.Name)
		if name == "" {
			middleware.RespondError(w, http.StatusBadRequest, "name cannot be empty")
			return
		}
	}

	email := row.Email.String
	if req.Email != nil {
		email = strings.ToLower(strings.TrimSpace(*req.Email))
		if email != row.Email.String {
			if taken, err := s.repos.Queries.IsEmailTaken(r.Context(), db.ParseText(email)); err == nil && taken {
				middleware.RespondError(w, http.StatusConflict, "email already in use")
				return
			}
		}
	}

	phone := row.Phone.String
	if req.Phone != nil {
		phone = strings.TrimSpace(*req.Phone)
		if phone != row.Phone.String {
			if taken, err := s.repos.Queries.IsPhoneTaken(r.Context(), db.ParseText(phone)); err == nil && taken {
				middleware.RespondError(w, http.StatusConflict, "phone already in use")
				return
			}
		}
	}

	role := row.Role
	if req.Role != nil {
		switch *req.Role {
		case "org_member", "org_admin":
			if *req.Role == "org_admin" && string(row.Role) != "org_admin" && me.Role != "superadmin" {
				middleware.RespondError(w, http.StatusForbidden, "only a platform superadmin can grant the org_admin role")
				return
			}
			if *req.Role != "org_admin" && string(row.Role) == "org_admin" && me.Role != "superadmin" {
				middleware.RespondError(w, http.StatusForbidden, "only a platform superadmin can demote an org_admin")
				return
			}
			role = sqldb.UserRole(*req.Role)
		default:
			middleware.RespondError(w, http.StatusBadRequest, "role must be org_member or org_admin")
			return
		}
	}

	lang := row.LanguagePref
	if req.LanguagePref != nil {
		if *req.LanguagePref != "en" && *req.LanguagePref != "ne" {
			middleware.RespondError(w, http.StatusBadRequest, "language_pref must be en or ne")
			return
		}
		lang = *req.LanguagePref
	}

	isActive := row.IsActive
	if req.IsActive != nil {
		// Prevent lockouts: an admin cannot deactivate their own account and
		// the last remaining org_admin of an org cannot be deactivated.
		if targetID == me.ID && !*req.IsActive {
			middleware.RespondError(w, http.StatusBadRequest, "you cannot deactivate your own account")
			return
		}
		if !*req.IsActive && string(row.Role) == "org_admin" {
			count, err := s.repos.Queries.CountActiveOrgAdmins(r.Context(), row.OrgID)
			if err == nil && count <= 1 {
				middleware.RespondError(w, http.StatusBadRequest, "cannot deactivate the last org admin")
				return
			}
		}
		isActive = *req.IsActive
	}

	updated, err := s.repos.Queries.UpdateUser(r.Context(), sqldb.UpdateUserParams{
		ID:           row.ID,
		Column2:      orgScopeForTarget(me, row.OrgID),
		Name:         name,
		Email:        db.ParseText(email),
		Phone:        db.ParseText(phone),
		Role:         role,
		LanguagePref: lang,
		IsActive:     isActive,
	})
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to update user")
		return
	}

	audit.Log(r, s.repos, "user.update", "user", row.ID, map[string]interface{}{
		"role":      string(role),
		"is_active": isActive,
	})

	middleware.RespondJSON(w, http.StatusOK, serializeUser(updated.ID, updated.OrgID, updated.Name, updated.DisplayName, updated.Email, updated.Phone, updated.AvatarUrl, updated.Role, updated.LanguagePref, updated.IsActive, updated.MustChangePassword, updated.LastLoginAt, updated.CreatedAt))
}

func (s *Service) resetPassword(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	targetID := chi.URLParam(r, "id")

	row, err := s.repos.Queries.GetUserByID(r.Context(), db.ParseUUID(targetID))
	if err != nil {
		middleware.RespondError(w, http.StatusNotFound, "user not found")
		return
	}
	if me.Role != "superadmin" && db.UUIDString(row.OrgID) != me.OrgID {
		middleware.RespondError(w, http.StatusNotFound, "user not found")
		return
	}
	if me.Role != "superadmin" && string(row.Role) == "org_admin" {
		middleware.RespondError(w, http.StatusForbidden, "only a platform superadmin can reset an org_admin's password")
		return
	}

	tempPw, err := password.GenerateTempPassword()
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to generate password")
		return
	}
	hashed, err := password.Hash(tempPw)
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to hash password")
		return
	}

	if err := s.repos.Queries.UpdatePasswordRequireReset(r.Context(), sqldb.UpdatePasswordRequireResetParams{
		ID:           row.ID,
		PasswordHash: db.ParseText(hashed),
	}); err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to reset password")
		return
	}

	// A password reset invalidates every active session.
	_ = s.repos.Queries.RevokeAllUserSessions(r.Context(), row.ID)

	if row.Email.String != "" {
		_ = s.mail.SendPasswordReset(row.Email.String, row.Name, tempPw)
	}

	audit.Log(r, s.repos, "user.reset_password", "user", row.ID, nil)
	middleware.RespondMessage(w, http.StatusOK, "password reset and emailed")
}

// ------------------------------ helpers ------------------------------

// orgScope returns a null UUID for superadmins (meaning "any org" in queries).
func orgScope(me *middleware.AuthUser) pgtype.UUID {
	if me.Role == "superadmin" {
		return pgtype.UUID{}
	}
	return db.ParseUUID(me.OrgID)
}

// orgScopeForTarget constrains mutations to the caller's org (for updates to a
// target already validated as being in that org). Superadmins pass null.
func orgScopeForTarget(me *middleware.AuthUser, targetOrgID pgtype.UUID) pgtype.UUID {
	if me.Role == "superadmin" {
		return targetOrgID
	}
	return db.ParseUUID(me.OrgID)
}

type userResponse struct {
	ID                 string  `json:"id"`
	Name               string  `json:"name"`
	DisplayName        *string `json:"display_name"`
	Email              *string `json:"email"`
	Phone              *string `json:"phone"`
	AvatarURL          *string `json:"avatar_url"`
	Role               string  `json:"role"`
	OrgID              *string `json:"org_id"`
	LanguagePref       string  `json:"language_pref"`
	IsActive           bool    `json:"is_active"`
	MustChangePassword bool    `json:"must_change_password"`
	LastLoginAt        *string `json:"last_login_at"`
	CreatedAt          string  `json:"created_at"`
}

func serializeUser(
	id, orgID pgtype.UUID,
	name string,
	displayName pgtype.Text,
	email, phone pgtype.Text,
	avatarURL pgtype.Text,
	role sqldb.UserRole,
	lang string,
	isActive, mustChange bool,
	lastLogin pgtype.Timestamptz,
	createdAt pgtype.Timestamptz,
) userResponse {
	resp := userResponse{
		ID:                 db.UUIDString(id),
		Name:               name,
		Role:               string(role),
		LanguagePref:       lang,
		IsActive:           isActive,
		MustChangePassword: mustChange,
		CreatedAt:          createdAt.Time.UTC().Format(time.RFC3339),
	}
	if displayName.Valid {
		d := displayName.String
		resp.DisplayName = &d
	}
	if avatarURL.Valid {
		a := avatarURL.String
		resp.AvatarURL = &a
	}
	if email.Valid {
		e := email.String
		resp.Email = &e
	}
	if phone.Valid {
		p := phone.String
		resp.Phone = &p
	}
	if orgID.Valid {
		o := db.UUIDString(orgID)
		resp.OrgID = &o
	}
	if lastLogin.Valid {
		t := lastLogin.Time.UTC().Format(time.RFC3339)
		resp.LastLoginAt = &t
	}
	return resp
}
