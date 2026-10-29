import assert from "node:assert/strict";
import test from "node:test";
import { mountEditor } from "./editor-dom.ts";

test("source and reference uploads retain native keyboard focus", async () => {
  const editor = await mountEditor();
  try {
    const inputs = [...editor.container.querySelectorAll<HTMLInputElement>('input[type="file"]')];
    assert.ok(inputs.length >= 2);
    for (const input of inputs) {
      assert.equal(input.hidden, false, `${input.accept} must participate in native keyboard navigation`);
      assert.equal(input.disabled, false);
      assert.equal(input.tabIndex, 0);
      input.focus();
      assert.equal(editor.dom.window.document.activeElement, input);
      assert.ok(input.closest("label")?.textContent?.trim(), "native input has its visible upload label");
    }
    await editor.metadata(await editor.chooseVideo("keyboard.mp4"), 12);
    assert.ok(editor.container.querySelector("video"), "native input change still selects the source");
  } finally { await editor.close(); }
});
