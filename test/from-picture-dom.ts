import { register } from "node:module";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
register(new URL("./tsx-loader.mjs", import.meta.url));

export async function mountFromPicture(options: { storage?: Record<string, unknown>; fetch?: typeof globalThis.fetch } = {}) {
  const dom = new JSDOM("<!doctype html><div id='app'></div>", { url: "http://127.0.0.1:3000" });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const expose = (name: string, value: unknown) => {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ["window", "document", "navigator", "localStorage", "HTMLElement", "HTMLInputElement", "Event", "File", "FormData"] as const) expose(name, dom.window[name]);
  expose("IS_REACT_ACT_ENVIRONMENT", true);
  expose("fetch", options.fetch ?? (async () => Response.json({ models: [], loras: [], textEncoders: [], vaes: [] })));
  for (const [key, value] of Object.entries(options.storage ?? {})) dom.window.localStorage.setItem(key, JSON.stringify(value));
  const createURL = URL.createObjectURL, revokeURL = URL.revokeObjectURL;
  let nextURL = 0;
  URL.createObjectURL = () => `blob:picture-test-${++nextURL}`;
  URL.revokeObjectURL = () => {};
  const { createRoot } = await import("react-dom/client");
  const { FromPicture } = await import("../components/from-picture.tsx");
  const container = dom.window.document.getElementById("app")!;
  const root = createRoot(container);
  let mounted = true;
  await act(async () => root.render(createElement(FromPicture)));
  return {
    dom, container,
    async chooseFile(kind: "video" | "picture", name: string) {
      const input = container.querySelector<HTMLInputElement>(`input[type="file"][accept^="${kind === "video" ? "video" : "image"}"]`)!;
      Object.defineProperty(input, "files", { configurable: true, value: [new dom.window.File(["fixture"], name, { type: kind === "video" ? "video/mp4" : "image/png" })] });
      await act(async () => input.dispatchEvent(new dom.window.Event("change", { bubbles: true })));
    },
    async metadata(width = 1280, height = 720) {
      const video = container.querySelector("video")!;
      Object.defineProperties(video, { videoWidth: { configurable: true, value: width }, videoHeight: { configurable: true, value: height } });
      await act(async () => video.dispatchEvent(new dom.window.Event("loadedmetadata")));
    },
    async click(text: string) {
      const button = [...container.querySelectorAll("button")].find((element) => element.textContent === text);
      if (!button) throw new Error(`Missing button: ${text}`);
      await act(async () => button.click());
    },
    async unmount() { if (mounted) { await act(async () => root.unmount()); mounted = false; } },
    async close() {
      if (mounted) await act(async () => root.unmount());
      URL.createObjectURL = createURL; URL.revokeObjectURL = revokeURL;
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
      }
      dom.window.close();
    },
  };
}
