package middleware

import (
	"context"
	"net/http"
	"strings"
)

type langKey struct{}

func Language(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lang := strings.SplitN(r.Header.Get("Accept-Language"), ",", 2)[0]
		if lang == "" {
			lang = "en"
		}
		ctx := context.WithValue(r.Context(), langKey{}, lang)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func GetLanguage(r *http.Request) string {
	if lang, ok := r.Context().Value(langKey{}).(string); ok {
		return lang
	}
	return "en"
}