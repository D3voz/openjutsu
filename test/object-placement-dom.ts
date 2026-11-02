import { register } from "node:module";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import type { ObjectPlacement } from "../components/object-placement.tsx";
register(new URL("./tsx-loader.mjs", import.meta.url));
type Props = Parameters<typeof ObjectPlacement>[0];

export async function mountPlacement(initial: Omit<Props, "onChange">) {
  const dom = new JSDOM("<!doctype html><div id='app'></div>", { url: "http://127.0.0.1:3000" });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Event: dom.window.Event,
    IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  dom.window.HTMLCanvasElement.prototype.setPointerCapture = () => {};
  dom.window.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0,
    right: 640, bottom: 360, width: 640, height: 360, toJSON() {} });
  const { createRoot } = await import("react-dom/client");
  const { ObjectPlacement: Component } = await import("../components/object-placement.tsx");
  const container = dom.window.document.getElementById("app")!;
  const root = createRoot(container);
  const changes: Props["points"][] = [];
  const onChange = (points: Props["points"]) => { changes.push(points); props = { ...props, points } as Props; render(); };
  let props = { ...initial, onChange } as Props;
  const render = () => root.render(createElement(Component, props));
  await act(async () => render());
  return {
    dom, container, changes,
    get video() { return container.querySelector("video")!; },
    async update(next: Partial<Omit<Props, "onChange">>) { props = { ...props, ...next } as Props; await act(async () => render()); },
    async click(text: string) {
      const button = [...container.querySelectorAll("button")].find((item) => item.textContent === text);
      if (!button) throw new Error(`No placement button ${text}`);
      await act(async () => button.click());
    },
    async pointer(type: string, pointerId: number, x: number, y: number) {
      const event = new dom.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, buttons: type === "pointerup" ? 0 : 1 });
      Object.defineProperty(event, "pointerId", { value: pointerId });
      await act(async () => container.querySelector("canvas")!.dispatchEvent(event));
    },
    async close() {
      await act(async () => root.unmount());
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
      }
      dom.window.close();
    },
  };
}
