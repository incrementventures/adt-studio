import path from "node:path";
import Database from "better-sqlite3";

export const SCHEMA_VERSION = 7;

export class SchemaMismatchError extends Error {
  constructor(
    public readonly found: number,
    public readonly expected: number
  ) {
    super(
      `Database schema version mismatch: found v${found}, expected v${expected}. Delete the book and reimport it.`
    );
    this.name = "SchemaMismatchError";
  }
}

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS book_metadata (
  source TEXT PRIMARY KEY CHECK (source IN ('stub', 'llm')),
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pdf_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pages (
  page_id TEXT PRIMARY KEY,
  page_number INTEGER NOT NULL,
  text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS node_data (
  node TEXT NOT NULL,
  item_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  data TEXT,
  PRIMARY KEY (node, item_id, version)
);

CREATE TABLE IF NOT EXISTS images (
  image_id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  path TEXT NOT NULL,
  hash TEXT NOT NULL DEFAULT '',
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('page', 'extract', 'crop'))
);

CREATE TABLE IF NOT EXISTS llm_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  data TEXT NOT NULL
);
`;

const globalForDb = globalThis as unknown as {
  __dbConnections?: Map<string, Database.Database>;
  __deletedLabels?: Set<string>;
};
const connections =
  globalForDb.__dbConnections ?? new Map<string, Database.Database>();
globalForDb.__dbConnections = connections;

const deletedLabels = globalForDb.__deletedLabels ?? new Set<string>();
globalForDb.__deletedLabels = deletedLabels;

function booksRoot(): string {
  return path.resolve(process.env.BOOKS_ROOT ?? "books");
}

export function getDb(label: string): Database.Database {
  if (deletedLabels.has(label)) {
    throw new Error(`Book "${label}" has been deleted`);
  }

  const existing = connections.get(label);
  if (existing) return existing;

  const dbPath = path.join(booksRoot(), label, `${label}.db`);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");

  initSchema(db);
  connections.set(label, db);
  return db;
}

function initSchema(db: Database.Database): void {
  const hasVersionTable = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
    )
    .get() as { name: string } | undefined;

  if (!hasVersionTable) {
    // Fresh DB — create everything
    db.exec(SCHEMA_SQL);
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(
      SCHEMA_VERSION
    );
    return;
  }

  // Existing DB — check version matches exactly
  const row = db
    .prepare("SELECT version FROM schema_version LIMIT 1")
    .get() as { version: number } | undefined;
  const existing = row?.version ?? 0;

  if (existing !== SCHEMA_VERSION) {
    db.close();
    throw new SchemaMismatchError(existing, SCHEMA_VERSION);
  }
}

export function closeDb(label: string): void {
  const db = connections.get(label);
  if (db) {
    db.close();
    connections.delete(label);
  }
  deletedLabels.add(label);
}

/** Re-allow DB access for a label (e.g. after reimport). */
export function undeleteDb(label: string): void {
  deletedLabels.delete(label);
}

export function closeAllDbs(): void {
  for (const [label, db] of connections) {
    db.close();
    connections.delete(label);
  }
}
