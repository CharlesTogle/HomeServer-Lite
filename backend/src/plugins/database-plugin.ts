import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import betterSqlite3 from 'better-sqlite3';
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS sessions_refresh_token_hash_unique_idx
    ON sessions (refresh_token_hash)
  `,
  `
  CREATE INDEX IF NOT EXISTS sessions_user_id_idx
    ON sessions (user_id)
  `,
  `
  CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_folder_id TEXT NULL REFERENCES folders(id) ON DELETE RESTRICT,
    display_name TEXT NOT NULL,
    is_root INTEGER NOT NULL DEFAULT 0,
    storage_rel_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS folders_storage_rel_path_unique_idx
    ON folders (storage_rel_path)
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS folders_sibling_name_unique_idx
    ON folders (user_id, COALESCE(parent_folder_id, 'NULL_PLACEHOLDER'), display_name)
  `,
  `
  CREATE INDEX IF NOT EXISTS folders_parent_lookup_idx
    ON folders (user_id, parent_folder_id)
  `,
  `
  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE RESTRICT,
    display_name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    stored_extension TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ready',
    storage_rel_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS files_storage_rel_path_unique_idx
    ON files (storage_rel_path)
  `,
  `
  CREATE INDEX IF NOT EXISTS files_folder_lookup_idx
    ON files (user_id, folder_id, created_at)
  `,
  `
  CREATE TABLE IF NOT EXISTS user_storage_usage (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    used_bytes INTEGER NOT NULL DEFAULT 0,
    quota_bytes INTEGER NOT NULL
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS upload_batches (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE RESTRICT,
    expected_count INTEGER,
    completed_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open',
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
  `,
  `
  CREATE INDEX IF NOT EXISTS upload_batches_user_id_idx
    ON upload_batches (user_id)
  `,
  `
  CREATE TABLE IF NOT EXISTS upload_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    batch_id TEXT NOT NULL REFERENCES upload_batches(id) ON DELETE CASCADE,
    client_idempotency_key TEXT NOT NULL,
    original_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
    error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
  `,
  `
  CREATE INDEX IF NOT EXISTS upload_items_batch_id_idx
    ON upload_items (batch_id)
  `,
  `
  CREATE INDEX IF NOT EXISTS upload_items_user_id_idx
    ON upload_items (user_id)
  `,
  // Migration 1: add deleted_at columns for trash support
  `ALTER TABLE folders ADD COLUMN deleted_at TEXT`,
  `ALTER TABLE files ADD COLUMN deleted_at TEXT`,
  // Migration 2: recreate sibling name unique index to exclude trashed folders
  `DROP INDEX IF EXISTS folders_sibling_name_unique_idx`,
  `CREATE UNIQUE INDEX IF NOT EXISTS folders_sibling_name_unique_idx ON folders (user_id, COALESCE(parent_folder_id, 'NULL_PLACEHOLDER'), display_name) WHERE deleted_at IS NULL`,
  // Migration 3: indexes for trash queries
  `CREATE INDEX IF NOT EXISTS files_deleted_at_idx ON files (user_id, deleted_at)`,
  `CREATE INDEX IF NOT EXISTS folders_deleted_at_idx ON folders (user_id, deleted_at)`,
  // Migration 4: shared folder support
  `CREATE TABLE IF NOT EXISTS shared_folder_members (
    folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (folder_id, user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS shared_folder_members_user_id_idx ON shared_folder_members (user_id, folder_id)`,
  // Migration 5: shared folder storage quota (50GB default)
  `CREATE TABLE IF NOT EXISTS shared_folder_storage (
    folder_id TEXT PRIMARY KEY REFERENCES folders(id) ON DELETE CASCADE,
    used_bytes INTEGER NOT NULL DEFAULT 0,
    quota_bytes INTEGER NOT NULL DEFAULT 53687091200
  )`,
  // Migration 6: favorites
  `CREATE TABLE IF NOT EXISTS user_favorites (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    item_kind TEXT NOT NULL CHECK(item_kind IN ('file', 'folder')),
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, item_id)
  )`,
  `CREATE INDEX IF NOT EXISTS user_favorites_user_id_idx ON user_favorites (user_id)`,
  // Migration 7: resumable upload progress tracking
  `ALTER TABLE upload_batches ADD COLUMN total_bytes INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE upload_batches ADD COLUMN received_bytes INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE upload_items ADD COLUMN mime_type TEXT NOT NULL DEFAULT 'application/octet-stream'`,
  `ALTER TABLE upload_items ADD COLUMN total_bytes INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE upload_items ADD COLUMN received_bytes INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE upload_items ADD COLUMN resolved_name TEXT`,
];

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

const databasePluginImpl: FastifyPluginAsync = async function databasePlugin(
  app,
): Promise<void> {
  const config = app.serverConfig;

  if (config.persistenceMode === 'test-memory') {
    const memDb = new betterSqlite3(':memory:');

  // Track which migrations have been applied to handle idempotent ALTER TABLE
  const alreadyRun = new Set<string>();
  const migrationTableExists = memDb
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'")
    .get();
  if (!migrationTableExists) {
    memDb.exec("CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL UNIQUE)");
  }
  const applied = memDb.prepare("SELECT hash FROM _migrations").all() as { hash: string }[];
  for (const row of applied) {
    alreadyRun.add(row.hash);
  }

  for (const migration of MIGRATIONS) {
    const hash = simpleHash(migration);
    if (alreadyRun.has(hash)) {
      continue;
    }
    try {
      memDb.exec(migration);
    } catch (error) {
      // Ignore "duplicate column" errors from re-running ALTER TABLE ADD COLUMN
      if (
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message: string }).message === 'string' &&
        (error as { message: string }).message.includes('duplicate column name')
      ) {
        // Column already exists — safe to skip
      } else {
        throw error;
      }
    }
    memDb.prepare("INSERT OR IGNORE INTO _migrations (hash) VALUES (?)").run(hash);
  }

  memDb.pragma('journal_mode = WAL');
  memDb.pragma('foreign_keys = ON');
  memDb.pragma('busy_timeout = 5000');

  app.decorate('sqliteDb', memDb);
  app.decorate('database', { mode: 'test-memory' });

  app.addHook('onClose', async () => {
    memDb.close();
  });

  return;
}

  const dbDir = path.dirname(config.sqlitePath);
  await mkdir(dbDir, { recursive: true });

  const db = new betterSqlite3(config.sqlitePath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // Track applied migrations for idempotent schema changes
  const prodAlreadyRun = new Set<string>();
  const prodMigrationTableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'")
    .get();
  if (!prodMigrationTableExists) {
    db.exec("CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL UNIQUE)");
  }
  const prodApplied = db.prepare("SELECT hash FROM _migrations").all() as { hash: string }[];
  for (const row of prodApplied) {
    prodAlreadyRun.add(row.hash);
  }

  for (const migration of MIGRATIONS) {
    const hash = simpleHash(migration);
    if (prodAlreadyRun.has(hash)) {
      continue;
    }
    try {
      db.exec(migration);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message: string }).message === 'string' &&
        (error as { message: string }).message.includes('duplicate column name')
      ) {
        // Column already exists — safe to skip
      } else {
        throw error;
      }
    }
    db.prepare("INSERT OR IGNORE INTO _migrations (hash) VALUES (?)").run(hash);
  }

  app.decorate('sqliteDb', db);
  app.decorate('database', { mode: 'sqlite' });

  app.addHook('onClose', async () => {
    db.close();
  });
};

export const databasePlugin = fp(databasePluginImpl, {
  name: 'database-plugin',
});
