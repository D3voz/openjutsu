import assert from "node:assert/strict";
import { open, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { HttpError, readFormData } from "../lib/http.ts";

function request(content: string, chunkSize: number, extra = "") {
  const bytes = Buffer.from(`--test-boundary\r\nContent-Disposition: form-data; name="video"; filename="clip.mp4"\r\n${extra}\r\n${content}\r\n--test-boundary--\r\n`);
  let offset = 0;
  return new Request("http://localhost/api/jobs", { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=test-boundary" },
    body: new ReadableStream({ pull(controller) {
      if (offset === bytes.length) controller.close();
      else controller.enqueue(bytes.subarray(offset, offset = Math.min(bytes.length, offset + chunkSize)));
    } }), duplex: "half" } as RequestInit);
}

test("multipart binary data may contain a boundary prefix without being a delimiter", async () => {
  const content = "before\r\n--test-boundaryXafter\r\n--test-boundary\rXtail";
  for (const size of [1, 2, 7, 64, 4096]) {
    const parsed = await readFormData(request(content, size));
    try { assert.equal(await (parsed.form.get("video") as File).text(), content); }
    finally { await parsed.dispose(); }
  }
});

test("the multipart header cap is independent of network chunk size", async () => {
  for (const size of [1000, 50_000]) {
    await assert.rejects(readFormData(request("data", size, `X-Long: ${"x".repeat(20_000)}\r\n`)),
      (error: unknown) => error instanceof HttpError && error.status === 400);
  }
});

test("short disk writes retain every uploaded byte", async () => {
  const path = join(tmpdir(), `openjutsu-short-write-${process.pid}`);
  const handle = await open(path, "wx");
  const prototype = Object.getPrototypeOf(handle);
  const original = prototype.write;
  await handle.close();
  // A FileHandle.write call is allowed to write fewer bytes than requested.
  prototype.write = function (buffer: Buffer) {
    return original.call(this, buffer.subarray(0, Math.max(1, Math.floor(buffer.length / 2))));
  };
  try {
    const content = "0123456789abcdef".repeat(1000);
    const parsed = await readFormData(request(content, 4096));
    try { assert.equal(await (parsed.form.get("video") as File).text(), content); }
    finally { await parsed.dispose(); }
  } finally { prototype.write = original; await rm(path); }
});
