import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { register } from "node:module";
import test from "node:test";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
register("data:text/javascript,export const resolve = (specifier, context, next) => next(specifier === 'next/server' ? 'next/server.js' : specifier, context);");
const { GET: output } = await import("../app/api/jobs/[id]/outputs/[outputId]/route.ts");
const { GET: picture } = await import("../app/api/picture/route.ts");
const json = Buffer.from(JSON.stringify({ tracks: "x".repeat(3000) }));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=", "base64");

for (const kind of ["output", "picture"] as const) for (const mode of ["gzip", "deflate", "br", "identity200", "identity206", "identity416", "coded206", "unknown-coding"] as const) {
  test(`${kind} preserves HTTP framing for ${mode}`, async (t) => {
    const bytes = kind === "output" ? json : png;
    let contentRequests = 0, requestedEncoding = "";
    const upstream = createServer((request, response) => {
      const sendJSON = (body: unknown) => { response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body)); };
      if (request.url === "/api/v2/jobs/job_1") return sendJSON({ id: "job_1", status: "succeeded", outputs: [], urls: {} });
      if (request.url === "/api/v2/assets/asset_1") return sendJSON({ id: "asset_1", job_id: "job_1", file_path: "tracks.json" });
      if (request.url === "/history/job_1") return sendJSON({ job_1: {
        prompt: [0, "job_1", { "21": { class_type: "SaveImage", _meta: { title: "OpenJutsu · prepared picture" } }, "3": { inputs: { width: 1280, height: 720 } } }],
        outputs: { "21": { images: [{ filename: "frame.png" }] } },
      } });
      const media = request.url?.startsWith("/view?") || request.url === "/api/v2/assets/asset_1/content";
      if (!media) { response.writeHead(404).end(); return; }
      if (kind === "output" && ++contentRequests === 1) {
        // The SDK first discovers the inline URL and discards this response.
        response.writeHead(200, { "Content-Type": "application/json", "Content-Length": bytes.length }).end(bytes); return;
      }
      requestedEncoding = String(request.headers["accept-encoding"] ?? "");
      const type = kind === "output" ? "application/json" : "image/png";
      if (mode === "identity200") { response.writeHead(200, { "Content-Type": type, "Content-Encoding": "identity", "Content-Length": String(bytes.length), "Accept-Ranges": "bytes" }).end(bytes); return; }
      if (mode === "unknown-coding") { response.writeHead(200, { "Content-Type": type, "Content-Encoding": "not-a-supported-coding", "Content-Length": "6" }).end("opaque"); return; }
      if (mode === "identity206") { response.writeHead(206, { "Content-Type": type, "Content-Length": "4", "Content-Range": `bytes 0-3/${bytes.length}`, "Accept-Ranges": "bytes" }).end(bytes.subarray(0, 4)); return; }
      if (mode === "identity416") { response.writeHead(416, { "Content-Range": `bytes */${bytes.length}` }).end("outside"); return; }
      const coding = mode === "coded206" ? "gzip" : mode;
      const encoded = coding === "gzip" ? gzipSync(bytes) : coding === "br" ? brotliCompressSync(bytes) : deflateSync(bytes);
      response.writeHead(mode === "coded206" ? 206 : 200, {
        "Content-Type": type, "Content-Encoding": coding, "Content-Length": String(encoded.length), "Accept-Ranges": "bytes", ETag: '"coded-strong-validator"',
        ...(mode === "coded206" ? { "Content-Range": `bytes 0-${encoded.length - 1}/${encoded.length}` } : {}),
      }).end(encoded);
    });
    upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
    const previous = { base: process.env.COMFY_BASE_URL, ui: process.env.COMFYUI_URL, password: process.env.OPENJUTSU_PASSWORD, key: process.env.COMFY_API_KEY };
    process.env.COMFY_BASE_URL = process.env.COMFYUI_URL = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    delete process.env.OPENJUTSU_PASSWORD; delete process.env.COMFY_API_KEY;
    const bridge = createServer((request, response) => {
      response.on("error", () => {});
      void (async () => {
        const headers = new Headers();
        if (request.headers.range) headers.set("Range", request.headers.range);
        const result = kind === "output"
          ? await output(new Request("http://localhost/api/jobs/job_1/outputs/asset_1", { headers }), { params: Promise.resolve({ id: "job_1", outputId: "asset_1" }) })
          : await picture(new Request("http://localhost/api/picture?id=job_1&media=result", { headers }));
        response.writeHead(result.status, Object.fromEntries(result.headers));
        if (result.body) {
          const reader = result.body.getReader();
          for (;;) { const { value, done } = await reader.read(); if (done) break; response.write(value); }
        }
        response.end();
      })().catch(() => response.destroy());
    });
    bridge.listen(0, "127.0.0.1"); await once(bridge, "listening");
    t.after(() => {
      bridge.closeAllConnections(); upstream.closeAllConnections(); bridge.close(); upstream.close();
      for (const [key, value] of [["COMFY_BASE_URL", previous.base], ["COMFYUI_URL", previous.ui], ["OPENJUTSU_PASSWORD", previous.password], ["COMFY_API_KEY", previous.key]] as const) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    });
    const range = mode === "identity206" ? "bytes=0-3" : mode === "identity416" ? "bytes=999999-" : mode === "coded206" ? `bytes=0-${gzipSync(bytes).length - 1}` : null;
    const response = await fetch(`http://127.0.0.1:${(bridge.address() as AddressInfo).port}/media`, { signal: AbortSignal.timeout(1500), headers: range ? { Range: range } : {} });
    if (mode === "identity200") {
      assert.equal(response.status, 200); assert.equal(response.headers.get("Content-Length"), String(bytes.length));
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    } else if (mode === "identity206") {
      assert.equal(response.status, 206); assert.equal(response.headers.get("Content-Length"), "4");
      assert.equal(response.headers.get("Content-Range"), `bytes 0-3/${bytes.length}`); assert.equal(response.headers.get("Accept-Ranges"), "bytes");
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(0, 4));
    } else if (mode === "identity416") {
      assert.equal(response.status, 416); assert.equal(response.headers.get("Content-Range"), `bytes */${bytes.length}`); assert.equal(await response.text(), "");
    } else if (mode === "coded206" || mode === "unknown-coding") {
      assert.equal(response.status, 502); assert.equal(response.headers.get("Content-Range"), null); assert.ok((await response.json()).error);
    } else {
      assert.equal(response.status, 200);
      // The native downstream client enforces the declared length. A wrong
      // compressed length truncates JSON or makes the shorter PNG wait forever.
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
      for (const header of ["Content-Length", "Content-Encoding", "Content-Range", "Accept-Ranges", "ETag"]) assert.equal(response.headers.get(header), null, header);
    }
    const requestedCodings = requestedEncoding.split(",").map((value) => value.trim().toLowerCase());
    assert.ok(requestedCodings.length > 0 && requestedCodings.every((value) => value === "identity"), requestedEncoding);
  });
}
