package db

import (
	"context"
	"fmt"

	sqlcdb "github.com/fintara/helpdesk/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repos struct {
	Pool    *pgxpool.Pool
	Queries *sqlcdb.Queries
}

func NewRepos(pool *pgxpool.Pool) *Repos {
	return &Repos{
		Pool:    pool,
		Queries: sqlcdb.New(pool),
	}
}

func (r *Repos) Ping(ctx context.Context) error {
	if err := r.Pool.Ping(ctx); err != nil {
		return fmt.Errorf("database ping: %w", err)
	}
	return nil
}