package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/fintara/helpdesk/internal/admin"
	"github.com/fintara/helpdesk/internal/auth"
	"github.com/fintara/helpdesk/internal/documents"
	"github.com/fintara/helpdesk/internal/groups"
	"github.com/fintara/helpdesk/internal/messages"
	"github.com/fintara/helpdesk/internal/profile"
	"github.com/fintara/helpdesk/internal/search"
	"github.com/fintara/helpdesk/internal/users"
	"github.com/fintara/helpdesk/pkg/db"
	"github.com/fintara/helpdesk/pkg/mailer"
	"github.com/fintara/helpdesk/pkg/middleware"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/joho/godotenv"
	"github.com/rs/cors"
)

func main() {
	_ = godotenv.Load()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL is required")
	}

	if os.Getenv("JWT_SECRET") == "" {
		log.Fatal("JWT_SECRET is required")
	}

	mail := mailer.New()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := db.NewPool(ctx, dsn)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("database ping failed: %v", err)
	}

	repos := db.NewRepos(pool)

	r := chi.NewRouter()
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(chimw.RequestID)
	r.Use(middleware.Language)

	allowedOrigins := []string{"http://localhost:3000", "http://localhost:3001"}
	if origins := os.Getenv("CORS_ORIGINS"); origins != "" {
		allowedOrigins = strings.Split(origins, ",")
	}

	c := cors.New(cors.Options{
		AllowedOrigins:   allowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
	})
	r.Use(c.Handler)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	r.Mount("/auth", auth.Handlers(repos, mail))
	r.Mount("/avatars", profile.AvatarHandler())
	r.Mount("/documents/files", documents.DocumentFileHandler())
	r.Group(func(r chi.Router) {
		r.Use(middleware.Auth(repos))
		r.Mount("/me", profile.Handlers(repos))
		r.Mount("/users", users.Handlers(repos, mail))
		r.Mount("/groups", groups.Handlers(repos))
		r.Mount("/messages", messages.Handlers(repos))
		r.Mount("/documents", documents.Handlers(repos))
		r.Mount("/search", search.Handlers(repos))
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireRole("superadmin", "org_admin"))
			r.Mount("/admin", admin.Handlers(repos))
		})
	})

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%s", port),
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Printf("server starting on :%s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server failed: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("shutting down...")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("server forced to shutdown: %v", err)
	}
	log.Println("server stopped")
}
