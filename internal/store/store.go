// Package store is the Mock server's persistence. Three small tables:
//
//	config     key → JSON value: the setup (OAuth clients, allowed emails, admin), the session secret
//	users      one row per signed-in account (provider + account id), last seen
//	libraries  one document per user: the MockBackup the browsers sync, with a revision number
//
// SQLite (pure Go, a file under ./data by default) or Postgres when DATABASE_URL is set.
// Writes to a library are compare-and-swap on `rev`, so two browsers never overwrite each other
// blindly: the loser gets the current document back and merges.
package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	_ "modernc.org/sqlite"
)

type User struct {
	ID         string  `json:"id"`
	Provider   string  `json:"provider"`
	Email      *string `json:"email"`
	Name       *string `json:"name"`
	Image      *string `json:"image"`
	CreatedAt  string  `json:"createdAt"`
	LastSeenAt string  `json:"lastSeenAt"`
}

type Library struct {
	Rev       int64           `json:"rev"`
	Doc       json.RawMessage `json:"doc"`
	UpdatedAt string          `json:"updatedAt"`
}

// PutResult is OK with the new revision, or not OK with the current library (nil when none).
type PutResult struct {
	OK        bool
	Rev       int64
	UpdatedAt string
	Current   *Library
}

type Store struct {
	db   *sql.DB
	Kind string // "sqlite" | "postgres"
}

var schema = []string{
	`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, provider TEXT NOT NULL, email TEXT, name TEXT, image TEXT, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS libraries (user_id TEXT PRIMARY KEY, rev INTEGER NOT NULL, doc TEXT NOT NULL, updated_at TEXT NOT NULL)`,
}

func now() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }

// Open picks Postgres when databaseURL is set, else SQLite at path (":memory:" for tests).
func Open(databaseURL, path string) (*Store, error) {
	if databaseURL != "" {
		return open("pgx", databaseURL, "postgres")
	}
	if path == "" {
		path = "data/mock.db"
	}
	dsn := path
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
			return nil, err
		}
		dsn = "file:" + path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)"
	}
	return open("sqlite", dsn, "sqlite")
}

func open(driver, dsn, kind string) (*Store, error) {
	db, err := sql.Open(driver, dsn)
	if err != nil {
		return nil, err
	}
	if kind == "sqlite" {
		// One connection: the revision check and the write never interleave, and ":memory:" stays one database.
		db.SetMaxOpenConns(1)
	}
	s := &Store{db: db, Kind: kind}
	for _, q := range schema {
		if kind == "postgres" {
			q = strings.Replace(q, "rev INTEGER", "rev BIGINT", 1)
		}
		if _, err := db.Exec(q); err != nil {
			db.Close()
			return nil, err
		}
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

// q rewrites ? placeholders to $n for Postgres.
func (s *Store) q(sql string) string {
	if s.Kind != "postgres" {
		return sql
	}
	var b strings.Builder
	n := 0
	for _, r := range sql {
		if r == '?' {
			n++
			b.WriteString("$" + strconv.Itoa(n))
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// GetConfig decodes the JSON stored at key into v; false when absent.
func (s *Store) GetConfig(ctx context.Context, key string, v any) (bool, error) {
	var raw string
	err := s.db.QueryRowContext(ctx, s.q(`SELECT value FROM config WHERE key = ?`), key).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, json.Unmarshal([]byte(raw), v)
}

func (s *Store) SetConfig(ctx context.Context, key string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, s.q(`INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`), key, string(b))
	return err
}

func nullable(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}

func (s *Store) UpsertUser(ctx context.Context, u User) (*User, error) {
	t := now()
	_, err := s.db.ExecContext(ctx, s.q(`INSERT INTO users (id, provider, email, name, image, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (id) DO UPDATE SET email = excluded.email, name = excluded.name, image = excluded.image, last_seen_at = excluded.last_seen_at`),
		u.ID, u.Provider, nullable(u.Email), nullable(u.Name), nullable(u.Image), t, t)
	if err != nil {
		return nil, err
	}
	return s.GetUser(ctx, u.ID)
}

func (s *Store) GetUser(ctx context.Context, id string) (*User, error) {
	var u User
	var email, name, image sql.NullString
	err := s.db.QueryRowContext(ctx, s.q(`SELECT id, provider, email, name, image, created_at, last_seen_at FROM users WHERE id = ?`), id).
		Scan(&u.ID, &u.Provider, &email, &name, &image, &u.CreatedAt, &u.LastSeenAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	str := func(n sql.NullString) *string {
		if !n.Valid {
			return nil
		}
		return &n.String
	}
	u.Email, u.Name, u.Image = str(email), str(name), str(image)
	return &u, nil
}

func (s *Store) CountUsers(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

func (s *Store) GetLibrary(ctx context.Context, userID string) (*Library, error) {
	var l Library
	var doc string
	err := s.db.QueryRowContext(ctx, s.q(`SELECT rev, doc, updated_at FROM libraries WHERE user_id = ?`), userID).Scan(&l.Rev, &doc, &l.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	l.Doc = json.RawMessage(doc)
	return &l, nil
}

// PutLibrary writes doc when the stored revision is still baseRev (0 = none yet).
// One statement each way, so the revision check is atomic on both databases.
func (s *Store) PutLibrary(ctx context.Context, userID string, baseRev int64, doc json.RawMessage) (PutResult, error) {
	t := now()
	var rev int64
	var err error
	if baseRev == 0 {
		err = s.db.QueryRowContext(ctx, s.q(`INSERT INTO libraries (user_id, rev, doc, updated_at) VALUES (?, 1, ?, ?) ON CONFLICT (user_id) DO NOTHING RETURNING rev`), userID, string(doc), t).Scan(&rev)
	} else {
		err = s.db.QueryRowContext(ctx, s.q(`UPDATE libraries SET rev = rev + 1, doc = ?, updated_at = ? WHERE user_id = ? AND rev = ? RETURNING rev`), string(doc), t, userID, baseRev).Scan(&rev)
	}
	if err == nil {
		return PutResult{OK: true, Rev: rev, UpdatedAt: t}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return PutResult{}, err
	}
	cur, err := s.GetLibrary(ctx, userID)
	return PutResult{Current: cur}, err
}

func (s *Store) DeleteLibrary(ctx context.Context, userID string) error {
	_, err := s.db.ExecContext(ctx, s.q(`DELETE FROM libraries WHERE user_id = ?`), userID)
	return err
}
