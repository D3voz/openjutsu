import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobStore } from "../lib/db.ts";

async function withStore(run: (store: JobStore, dir: string) => void | Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "openjutsu-db-"));
  const store = new JobStore(join(dir, "test.db"));
  try {
    await run(store, dir);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("records a job and keeps its parameters when the status changes", async () => {
  await withStore((store) => {
    store.saveJob({ id: "job-1", kind: "simple", status: "queued", title: "simple · person", params: { seed: 42 } });
    const queued = store.getJob("job-1");
    assert.equal(queued?.status, "queued");
    assert.deepEqual(queued?.params, { seed: 42 });

    store.saveJob({ id: "job-1", kind: "simple", status: "succeeded", result: { video: "out.mp4" } });
    const done = store.getJob("job-1");
    assert.equal(done?.status, "succeeded");
    assert.deepEqual(done?.params, { seed: 42 }, "parameters survive a status update");
    assert.deepEqual(done?.result, { video: "out.mp4" });
    assert.equal(done?.createdAt, queued?.createdAt);
  });
});

test("lists jobs newest first with filters and paging", async () => {
  await withStore((store) => {
    store.saveJob({ id: "a", kind: "simple", status: "queued", title: "A" });
    store.saveJob({ id: "b", kind: "object", status: "failed", title: "B" });
    store.saveJob({ id: "c", kind: "simple", status: "queued", title: "C" });

    const all = store.listJobs({ limit: 2 });
    assert.equal(all.total, 3);
    assert.equal(all.jobs.length, 2);
    assert.equal(all.jobs[0].id, "c");

    const failed = store.listJobs({ status: "failed" });
    assert.deepEqual(failed.jobs.map((job) => job.id), ["b"]);

    const simple = store.listJobs({ kind: "simple", limit: 10 });
    assert.equal(simple.total, 2);
  });
});

test("exports and imports a snapshot, replacing or merging", async () => {
  await withStore(async (store, dir) => {
    store.saveJob({ id: "one", kind: "simple", status: "succeeded", title: "One", params: { seed: 1 } });
    store.logEvent("one", "status", "succeeded");
    const snapshot = store.exportSnapshot();
    store.close();

    const restored = new JobStore(join(dir, "restored.db"));
    try {
      assert.equal(restored.importSnapshot(snapshot).jobs, 1);
      assert.equal(restored.getJob("one")?.status, "succeeded");
      assert.equal(restored.events("one").length, 1);

      restored.saveJob({ id: "two", kind: "face", status: "queued", title: "Two" });
      assert.equal(restored.stats().jobs, 2);

      restored.importSnapshot(snapshot, { replace: true });
      assert.equal(restored.stats().jobs, 1, "replace drops the extra job");
      assert.equal(restored.getJob("two"), null);
    } finally {
      restored.close();
    }
  });
});

test("prunes old jobs and reports stats", async () => {
  await withStore((store) => {
    store.saveJob({ id: "old", kind: "simple", status: "succeeded", title: "Old" });
    store.db.prepare("UPDATE jobs SET updated_at = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", "old");
    store.saveJob({ id: "new", kind: "color", status: "queued", title: "New" });

    const stats = store.stats();
    assert.equal(stats.jobs, 2);
    assert.equal(stats.byKind.color, 1);

    const pruned = store.prune(30);
    assert.equal(pruned.jobs, 1);
    assert.equal(store.getJob("old"), null);
    assert.equal(store.getJob("new")?.status, "queued");
  });
});

test("backs up a consistent copy while the store stays open", async () => {
  await withStore((store, dir) => {
    store.saveJob({ id: "live", kind: "simple", status: "queued", title: "Live" });
    const copy = join(dir, "copy.db");
    store.backupTo(copy);

    // The source keeps changing after the copy: the copy must not see those writes.
    store.saveJob({ id: "later", kind: "simple", status: "queued", title: "Later" });

    const restored = new JobStore(copy);
    try {
      assert.equal(restored.getJob("live")?.title, "Live");
      assert.equal(restored.getJob("later"), null);
    } finally {
      restored.close();
    }

    store.backupTo(copy);
    const again = new JobStore(copy);
    try {
      assert.equal(again.getJob("later")?.title, "Later", "a second backup replaces the old copy");
      assert.equal(again.stats().jobs, 2);
    } finally {
      again.close();
    }
  });
});

test("rejects a snapshot from a newer schema", async () => {
  await withStore((store) => {
    assert.throws(() => store.importSnapshot({ schemaVersion: 99, exportedAt: "", meta: {}, jobs: [], events: [] }), /schema 99/);
  });
});
