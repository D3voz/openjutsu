import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Node's built-in SQLite (no native package to compile, which matters on Colab).
// Requires Node 22.13+ (or 23.4+), where node:sqlite no longer needs a flag.

export const SCHEMA_VERSION = 1;

export type JobRecord = {
  id: string;
  kind: string;
  status: string;
  title: string | null;
  params: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  comfyPromptId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JobInput = {
  id: string;
  kind: string;
  status: string;
  title?: string | null;
  params?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  comfyPromptId?: string | null;
};

export type JobList = {
  jobs: JobRecord[];
  total: number;
  limit: number;
  offset: number;
};

export type Snapshot = {
  schemaVersion: number;
  exportedAt: string;
  meta: Record<string, string>;
  jobs: JobRecord[];
  events: { jobId: string | null; at: string; type: string; message: string | null }[];
};

export type Stats = {
  jobs: number;
  byStatus: Record<string, number>;
  byKind: Record<string, number>;
  lastJobAt: string | null;
};

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT,
  params_json TEXT,
  result_json TEXT,
  comfy_prompt_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_created_at ON jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs (status);
CREATE INDEX IF NOT EXISTS jobs_kind ON jobs (kind);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT,
  at TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT
);
CREATE INDEX IF NOT EXISTS events_job ON events (job_id, id);
`;

function now() {
  return new Date().toISOString();
}

function parseJson(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function rowToJob(row: Record<string, unknown>): JobRecord {
  return {
    id: String(row.id),
    kind: String(row.kind),
    status: String(row.status),
    title: row.title === null || row.title === undefined ? null : String(row.title),
    params: parseJson(row.params_json),
    result: parseJson(row.result_json),
    comfyPromptId: row.comfy_prompt_id === null || row.comfy_prompt_id === undefined ? null : String(row.comfy_prompt_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

// A thin, synchronous wrapper around one SQLite file. Next keeps one instance per process
// (see getStore); tests and scripts build their own on a temporary or custom path.
export class JobStore {
  readonly path: string;
  readonly db: DatabaseSync;

  constructor(path = databasePath()) {
    this.path = resolve(/* turbopackIgnore: true */ path);
    mkdirSync(dirname(this.path), { recursive: true });
    this.db = new DatabaseSync(this.path);
    this.db.exec(SCHEMA);
    this.setMeta("schema_version", String(SCHEMA_VERSION));
  }

  private closed = false;

  close() {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  setMeta(key: string, value: string) {
    this.db.prepare(`INSERT INTO meta (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(key, value, now());
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value?: string } | undefined;
    return row?.value ?? null;
  }

  allMeta(): Record<string, string> {
    const rows = this.db.prepare("SELECT key, value FROM meta ORDER BY key").all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map((row) => [row.key, String(row.value)]));
  }

  // Insert or refresh a job. Only the fields given are replaced, so a later status poll
  // can update state without losing the parameters recorded at submit time.
  saveJob(input: JobInput): JobRecord {
    const at = now();
    const existing = this.db.prepare("SELECT created_at FROM jobs WHERE id = ?").get(input.id) as { created_at?: string } | undefined;
    const params = input.params === undefined ? undefined : JSON.stringify(input.params);
    const result = input.result === undefined ? undefined : JSON.stringify(input.result);
    if (!existing) {
      this.db.prepare(`INSERT INTO jobs
        (id, kind, status, title, params_json, result_json, comfy_prompt_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        input.id, input.kind, input.status, input.title ?? null, params ?? null, result ?? null, input.comfyPromptId ?? null, at, at,
      );
    } else {
      const current = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(input.id) as {
        title: string | null; params_json: string | null; result_json: string | null; comfy_prompt_id: string | null;
      };
      this.db.prepare(`UPDATE jobs SET kind = ?, status = ?, title = ?, params_json = ?, result_json = ?, comfy_prompt_id = ?, updated_at = ?
        WHERE id = ?`).run(
        input.kind,
        input.status,
        input.title !== undefined ? input.title : current.title,
        params !== undefined ? params : current.params_json,
        result !== undefined ? result : current.result_json,
        input.comfyPromptId !== undefined ? input.comfyPromptId : current.comfy_prompt_id,
        at,
        input.id,
      );
    }
    return this.getJob(input.id)!;
  }

  getJob(id: string): JobRecord | null {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToJob(row) : null;
  }

  listJobs(options: { limit?: number; offset?: number; status?: string; kind?: string } = {}): JobList {
    const limit = Math.min(Math.max(1, Math.trunc(options.limit ?? 50)), 500);
    const offset = Math.max(0, Math.trunc(options.offset ?? 0));
    const where: string[] = [];
    const values: (string | number)[] = [];
    if (options.status) {
      where.push("status = ?");
      values.push(options.status);
    }
    if (options.kind) {
      where.push("kind = ?");
      values.push(options.kind);
    }
    const clause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM jobs${clause}`).get(...values) as { n: number }).n;
    const rows = this.db.prepare(`SELECT * FROM jobs${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(...values, limit, offset) as Record<string, unknown>[];
    return { jobs: rows.map(rowToJob), total: Number(total), limit, offset };
  }

  deleteJob(id: string): boolean {
    const statement = this.db.prepare("DELETE FROM jobs WHERE id = ?").run(id);
    this.db.prepare("DELETE FROM events WHERE job_id = ?").run(id);
    return Number(statement.changes) > 0;
  }

  logEvent(jobId: string | null, type: string, message: string | null = null) {
    this.db.prepare("INSERT INTO events (job_id, at, type, message) VALUES (?, ?, ?, ?)").run(jobId, now(), type, message);
  }

  events(jobId: string, limit = 200) {
    return this.db.prepare("SELECT at, type, message FROM events WHERE job_id = ? ORDER BY id DESC LIMIT ?").all(jobId, limit) as {
      at: string; type: string; message: string | null;
    }[];
  }

  stats(): Stats {
    const jobs = (this.db.prepare("SELECT COUNT(*) AS n FROM jobs").get() as { n: number }).n;
    const byStatus = Object.fromEntries((this.db.prepare("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status").all() as { status: string; n: number }[])
      .map((row) => [row.status, Number(row.n)]));
    const byKind = Object.fromEntries((this.db.prepare("SELECT kind, COUNT(*) AS n FROM jobs GROUP BY kind").all() as { kind: string; n: number }[])
      .map((row) => [row.kind, Number(row.n)]));
    const last = this.db.prepare("SELECT MAX(created_at) AS at FROM jobs").get() as { at: string | null };
    return { jobs: Number(jobs), byStatus, byKind, lastJobAt: last.at ?? null };
  }

  // Delete old finished jobs (kept for the UI history) and orphaned events.
  prune(days: number): { jobs: number; events: number } {
    const cutoff = new Date(Date.now() - Math.max(0, days) * 86_400_000).toISOString();
    const jobs = this.db.prepare("DELETE FROM jobs WHERE updated_at < ?").run(cutoff);
    const events = this.db.prepare("DELETE FROM events WHERE job_id IS NOT NULL AND job_id NOT IN (SELECT id FROM jobs)").run();
    return { jobs: Number(jobs.changes), events: Number(events.changes) };
  }

  // VACUUM INTO writes a consistent copy while other connections keep using the file, so a copy
  // taken mid-job (the Drive backups while the app runs) is never a torn WAL snapshot.
  backupTo(target: string): string {
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target)) rmSync(target);
    this.db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    return target;
  }

  exportSnapshot(): Snapshot {
    const jobs = (this.db.prepare("SELECT * FROM jobs ORDER BY created_at").all() as Record<string, unknown>[]).map(rowToJob);
    const events = (this.db.prepare("SELECT job_id, at, type, message FROM events ORDER BY id").all() as
      { job_id: string | null; at: string; type: string; message: string | null }[])
      .map((row) => ({ jobId: row.job_id ?? null, at: String(row.at), type: String(row.type), message: row.message ?? null }));
    return { schemaVersion: SCHEMA_VERSION, exportedAt: now(), meta: this.allMeta(), jobs, events };
  }

  // Replace or merge a snapshot, in one transaction so a failed import leaves the file untouched.
  importSnapshot(snapshot: Snapshot, options: { replace?: boolean } = {}): { jobs: number } {
    if (!snapshot || !Array.isArray(snapshot.jobs)) throw new Error("The snapshot has no jobs list.");
    if (snapshot.schemaVersion > SCHEMA_VERSION) throw new Error(`The snapshot uses schema ${snapshot.schemaVersion}; this build supports ${SCHEMA_VERSION}.`);
    let jobs = 0;
    this.db.exec("BEGIN");
    try {
      if (options.replace) {
        this.db.exec("DELETE FROM jobs");
        this.db.exec("DELETE FROM events");
      }
      for (const [key, value] of Object.entries(snapshot.meta ?? {})) if (key !== "schema_version") this.setMeta(key, String(value));
      for (const job of snapshot.jobs) {
        if (!job || typeof job.id !== "string" || !job.id) continue;
        this.saveJob({
          id: job.id,
          kind: String(job.kind ?? "unknown"),
          status: String(job.status ?? "unknown"),
          title: job.title ?? null,
          params: job.params ?? null,
          result: job.result ?? null,
          comfyPromptId: job.comfyPromptId ?? null,
        });
        jobs++;
      }
      for (const event of snapshot.events ?? []) {
        if (!event || typeof event.type !== "string") continue;
        this.db.prepare("INSERT INTO events (job_id, at, type, message) VALUES (?, ?, ?, ?)").run(
          event.jobId ?? null, String(event.at ?? now()), event.type, event.message ?? null,
        );
      }
      this.setMeta("schema_version", String(SCHEMA_VERSION));
      this.setMeta("last_import_at", now());
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { jobs };
  }

  sizeBytes(): number {
    try {
      return statSync(this.path).size;
    } catch {
      return 0;
    }
  }
}

export function databasePath() {
  return process.env.OPENJUTSU_DB_PATH?.trim() || join(process.cwd(), "data", "openjutsu.db");
}

export function isDatabaseEnabled() {
  return process.env.OPENJUTSU_DB !== "off";
}

// One handle per process, shared by every route and kept across dev hot reloads.
// With OPENJUTSU_DB=off callers get this error instead: job recording treats it as
// "no history", and the API answers 500 rather than pretending the file exists.
export function getStore(): JobStore {
  if (!isDatabaseEnabled()) throw new Error("The job database is off (OPENJUTSU_DB=off).");
  const holder = globalThis as { [key: symbol]: JobStore | undefined };
  return (holder[Symbol.for("openjutsu.store")] ??= new JobStore());
}
