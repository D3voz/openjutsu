import assert from "node:assert/strict";
import test from "node:test";
import { fakeProxy } from "./proxy.ts";

test("the streaming proxy fixture counts payload bytes with either permitted multipart ending", async () => {
  const proxy = await fakeProxy();
  try {
    for (const length of [0, 1, 5, 100_000]) for (const ending of ["", "\r\n"]) {
      const boundary = "fixture-boundary";
      const field = (name: string, value: string) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
      const head = field("expected_hash", `hash-${length}-${ending.length}`) + field("content_type", "video/mp4") + field("file_path", "clip.mp4")
        + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip.mp4"\r\nContent-Type: video/mp4\r\n\r\n`;
      const body = Buffer.concat([Buffer.from(head), Buffer.alloc(length, 42), Buffer.from(`\r\n--${boundary}--${ending}`)]);
      const response = await fetch(`${proxy.url}/api/v2/assets`, { method: "POST", headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` }, body });
      assert.equal(response.status, 201);
      assert.equal(proxy.uploads.at(-1)!.size, length, `payload=${length}, terminal CRLF=${ending.length === 2}`);
    }
  } finally { await proxy.close(); }
});
