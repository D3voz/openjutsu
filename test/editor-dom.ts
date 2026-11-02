import { register } from "node:module";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";

register(new URL("./tsx-loader.mjs", import.meta.url));

export async function mountEditor(options: { storage?: Record<string, unknown>; fetch?: typeof globalThis.fetch } = {}) {
  const dom = new JSDOM("<!doctype html><div id='app'></div>", { url: "http://127.0.0.1:3000" });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const expose = (name: string, value: unknown) => {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ["window", "document", "navigator", "localStorage", "HTMLElement", "HTMLInputElement", "Event", "File"] as const) expose(name, dom.window[name]);
  expose("IS_REACT_ACT_ENVIRONMENT", true);
  expose("fetch", options.fetch ?? (async (url: string) => Response.json(url.includes("presets") ? { tone: [] } : { models: [], loras: [], textEncoders: [], vaes: [] })));
  const sources: { url: string; onmessage: ((message: { data: string }) => void) | null; close: () => void }[] = [];
  expose("EventSource", class {
    onmessage = null;
    url: string;
    constructor(url: string) { this.url = url; sources.push(this); }
    close() {}
  });
  dom.window.localStorage.setItem("openjutsu.welcome", "1");
  for (const [key, value] of Object.entries(options.storage ?? {})) dom.window.localStorage.setItem(key, JSON.stringify(value));
  const createURL = URL.createObjectURL, revokeURL = URL.revokeObjectURL;
  let nextURL = 0;
  URL.createObjectURL = () => `blob:test-${++nextURL}`;
  URL.revokeObjectURL = () => {};
  const videos: HTMLVideoElement[] = [];
  const create = dom.window.document.createElement.bind(dom.window.document);
  dom.window.document.createElement = ((tag: string, options?: ElementCreationOptions) => {
    const element = create(tag, options);
    if (tag === "video") videos.push(element as HTMLVideoElement);
    return element;
  }) as typeof dom.window.document.createElement;
  const { createRoot } = await import("react-dom/client");
  const { Openjutsu } = await import("../components/openjutsu.tsx");
  const container = dom.window.document.getElementById("app")!;
  const root = createRoot(container);
  await act(async () => root.render(createElement(Openjutsu)));
  return {
    dom, container, videos, sources,
    async chooseVideo(name: string) {
      const input = container.querySelector<HTMLInputElement>('input[type="file"][accept^="video"]')!;
      Object.defineProperty(input, "files", { configurable: true, value: [new dom.window.File(["fixture"], name, { type: "video/mp4" })] });
      await act(async () => input.dispatchEvent(new dom.window.Event("change", { bubbles: true })));
      return videos.filter((video) => !video.isConnected).at(-1)!;
    },
    async metadata(video: HTMLVideoElement, duration: number, width = 640, height = 360) {
      Object.defineProperties(video, { duration: { configurable: true, value: duration }, videoWidth: { configurable: true, value: width }, videoHeight: { configurable: true, value: height } });
      await act(async () => video.dispatchEvent(new dom.window.Event("loadedmetadata")));
    },
    async close() {
      await act(async () => root.unmount());
      URL.createObjectURL = createURL; URL.revokeObjectURL = revokeURL;
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
      dom.window.close();
    },
  };
}
