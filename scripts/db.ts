#!/usr/bin/env node
// Small maintenance CLI for the Openjutsu SQLite store.
// Run it with: npm run db -- <command>
// (package.json uses `node --experimental-strip-types scripts/db.ts`).

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { databasePath, JobStore, SCHEMA_VERSION, type Snapshot } from "../lib/db.ts";

const args = process.argv.slice(2);
const command = args[0] ?? "info";
const value = (name: string, fallback?: string) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1] ?? fallback;
};
const flag = (name: string) => args.includes(`--${name}`);
// Flags that take a value, so their value is not mistaken for a positional argument.
const VALUED_FLAGS = new Set(["db", "limit", "status", "kind", "days"]);
const positionals: string[] = [];
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (arg.startsWith("--")) {
    if (VALUED_FLAGS.has(arg.slice(2))) index++;
    continue;
  }
  positionals.push(arg);
}
const path = resolve(value("db", process.env.OPENJUTSU_DB_PATH || databasePath()));

function open() {
  return new JobStore(path);
}

function human(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function usage() {
  console.log(`Openjutsu SQLite

  npm run db -- info                       File, schema and counts
  npm run db -- init                       Create the schema
  npm run db -- list [--limit 50]          Recent jobs
  npm run db -- export [file]              JSON snapshot (stdout without a file)
  npm run db -- import <file> [--replace]  Load a JSON snapshot
  npm run db -- backup <file>              Consistent copy of the .db file
  npm run db -- restore <file>             Replace the .db file from a copy
  npm run db -- prune --days 30            Delete jobs older than N days
  npm run db -- vacuum                     Compact the file

Options: --db <path> (default: OPENJUTSU_DB_PATH or data/openjutsu.db)
`);
}

const store = command === "restore" ? null : open();

try {
  switch (command) {
    case "init": {
      console.log(`Database ready at ${path} (schema ${SCHEMA_VERSION}).`);
      break;
    }
    case "info": {
      const stats = store!.stats();
      console.log(`Path:    ${path}`);
      console.log(`Size:    ${human(store!.sizeBytes())}`);
      console.log(`Schema:  ${store!.getMeta("schema_version") ?? "?"}`);
      console.log(`Jobs:    ${stats.jobs} (last ${stats.lastJobAt ?? "never"})`);
      for (const [status, count] of Object.entries(stats.byStatus)) console.log(`  ${status.padEnd(10)} ${count}`);
      break;
    }
    case "list": {
      const list = store!.listJobs({
        limit: Number(value("limit", "20")),
        status: value("status"),
        kind: value("kind"),
      });
      for (const job of list.jobs) console.log(`${job.createdAt}  ${job.status.padEnd(10)} ${job.kind.padEnd(13)} ${job.id}  ${job.title ?? ""}`);
      console.log(`${list.jobs.length} of ${list.total}`);
      break;
    }
    case "export": {
      const snapshot = store!.exportSnapshot();
      const text = JSON.stringify(snapshot, null, 2);
      const target = positionals[1];
      if (target) {
        writeFileSync(resolve(target), text);
        console.log(`Exported ${snapshot.jobs.length} jobs to ${resolve(target)}.`);
      } else {
        console.log(text);
      }
      break;
    }
    case "import": {
      const source = positionals[1];
      if (!source) throw new Error("Pass the snapshot file: npm run db -- import <file>");
      const snapshot = JSON.parse(readFileSync(resolve(source), "utf8")) as Snapshot;
      const result = store!.importSnapshot(snapshot, { replace: flag("replace") });
      console.log(`Imported ${result.jobs} jobs${flag("replace") ? " (replaced)" : ""}.`);
      break;
    }
    case "backup": {
      const target = positionals[1];
      if (!target) throw new Error("Pass the destination file: npm run db -- backup <file>");
      store!.backupTo(resolve(target));
      console.log(`Backed up to ${resolve(target)}.`);
      break;
    }
    case "restore": {
      const source = positionals[1];
      if (!source) throw new Error("Pass the backup file: npm run db -- restore <file>");
      if (!existsSync(resolve(source))) throw new Error(`No file at ${resolve(source)}.`);
      mkdirSync(dirname(path), { recursive: true });
      copyFileSync(resolve(source), path);
      console.log(`Restored ${path} from ${resolve(source)}. Restart the app if it is running.`);
      break;
    }
    case "prune": {
      const result = store!.prune(Number(value("days", "30")));
      console.log(`Removed ${result.jobs} jobs and ${result.events} orphaned events.`);
      break;
    }
    case "vacuum": {
      store!.db.exec("VACUUM");
      console.log(`Compacted ${path} (${human(store!.sizeBytes())}).`);
      break;
    }
    default:
      usage();
      process.exitCode = command === "help" || command === "--help" ? 0 : 1;
  }
} finally {
  store?.close();
}
