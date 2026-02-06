import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import type { Database as SqlJsRawDatabase, SqlJsStatic } from "sql.js";

const esmRequire = createRequire(import.meta.url);
const initSqlJs = esmRequire("sql.js") as (config?: Record<string, unknown>) => Promise<SqlJsStatic>;
const SQL = await initSqlJs();

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

// ---------------------------------------------------------------------------
// sql.js wrapper — provides the same API surface as better-sqlite3
// ---------------------------------------------------------------------------

class SqlJsDatabase {
  private db: SqlJsRawDatabase;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    if (fs.existsSync(dbPath)) {
      const buffer = fs.readFileSync(dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }
  }

  prepare(sql: string) {
    const self = this;
    return {
      run(...params: unknown[]) {
        self.db.run(sql, params as Parameters<SqlJsRawDatabase["run"]>[1]);
        const changes = self.db.getRowsModified();
        self.persist();
        return { changes };
      },
      get(...params: unknown[]): Record<string, unknown> | undefined {
        const stmt = self.db.prepare(sql);
        if (params.length > 0) {
          stmt.bind(params as Parameters<typeof stmt.bind>[0]);
        }
        if (stmt.step()) {
          const row = stmt.getAsObject();
          stmt.free();
          return row as Record<string, unknown>;
        }
        stmt.free();
        return undefined;
      },
      all(...params: unknown[]): Record<string, unknown>[] {
        const stmt = self.db.prepare(sql);
        if (params.length > 0) {
          stmt.bind(params as Parameters<typeof stmt.bind>[0]);
        }
        const rows: Record<string, unknown>[] = [];
        while (stmt.step()) {
          rows.push(stmt.getAsObject() as Record<string, unknown>);
        }
        stmt.free();
        return rows;
      },
    };
  }

  exec(sql: string): void {
    this.db.exec(sql);
    this.persist();
  }

  pragma(pragma: string): unknown {
    const results = this.db.exec(`PRAGMA ${pragma}`);
    this.persist();
    if (results.length > 0 && results[0].values.length > 0) {
      return results[0].values[0][0];
    }
    return undefined;
  }

  close(): void {
    this.persist();
    this.db.close();
  }

  private persist(): void {
    const data = this.db.export();
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }
}

// ---------------------------------------------------------------------------
// Connection pool (unchanged logic)
// ---------------------------------------------------------------------------

const globalForDb = globalThis as unknown as {
  __dbConnections?: Map<string, SqlJsDatabase>;
  __deletedLabels?: Set<string>;
};
const connections =
  globalForDb.__dbConnections ?? new Map<string, SqlJsDatabase>();
globalForDb.__dbConnections = connections;

const deletedLabels = globalForDb.__deletedLabels ?? new Set<string>();
globalForDb.__deletedLabels = deletedLabels;

function booksRoot(): string {
  return path.resolve(process.env.BOOKS_ROOT ?? "books");
}

export function getDb(label: string): SqlJsDatabase {
  if (deletedLabels.has(label)) {
    throw new Error(`Book "${label}" has been deleted`);
  }

  const existing = connections.get(label);
  if (existing) return existing;

  const dbPath = path.join(booksRoot(), label, `${label}.db`);
  const db = new SqlJsDatabase(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");

  initSchema(db);
  connections.set(label, db);
  return db;
}

function initSchema(db: SqlJsDatabase): void {
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
