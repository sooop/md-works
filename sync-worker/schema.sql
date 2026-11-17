CREATE TABLE IF NOT EXISTS spaces (
  space_id    TEXT PRIMARY KEY,
  app_id      TEXT NOT NULL,
  token_hash  TEXT NOT NULL,
  seq         INTEGER NOT NULL DEFAULT 0,
  item_count  INTEGER NOT NULL DEFAULT 0,
  bytes_used  INTEGER NOT NULL DEFAULT 0,
  day         TEXT NOT NULL DEFAULT '',
  day_writes  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  purged_seq  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS items (
  space_id    TEXT NOT NULL,
  item_id     TEXT NOT NULL,
  rev         INTEGER NOT NULL,
  seq         INTEGER NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0,
  size        INTEGER NOT NULL DEFAULT 0,
  blob        TEXT NOT NULL DEFAULT '',
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (space_id, item_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_items_seq ON items (space_id, seq);
