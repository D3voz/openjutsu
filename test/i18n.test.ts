import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { preferredLocale, translate } from "../lib/i18n.ts";

test("saved language wins, otherwise the first supported browser language is used", () => {
  assert.equal(preferredLocale("en", ["zh-CN"]), "en");
  assert.equal(preferredLocale("zh-CN", ["en-US"]), "zh-CN");
  assert.equal(preferredLocale(null, ["fr-FR", "zh-TW", "en"]), "zh-CN");
  assert.equal(preferredLocale("invalid", ["en-GB", "zh-CN"]), "en");
  assert.equal(preferredLocale(null, ["fr-FR"]), "en");
  assert.equal(preferredLocale(null, []), "en");
});

test("translation preserves variables, spacing, zero values and unknown diagnostics", () => {
  assert.equal(translate("zh-CN", "Generate"), "生成");
  assert.equal(translate("en", "Generate"), "Generate");
  assert.equal(translate("zh-CN", "Appearances: {count}", { count: 0 }), "出场片段：0");
  assert.equal(translate("en", "Appearances: {count}", { count: 2 }), "Appearances: 2");
  assert.equal(translate("zh-CN", " About "), " 约 ");
  assert.equal(translate("zh-CN", "Photo {index}"), "照片 {index}");
  const diagnostic = "RuntimeError: model/file.safetensors is unavailable";
  assert.equal(translate("zh-CN", diagnostic), diagnostic);
  assert.equal(translate("zh-CN", "toString"), "toString");
});

test("Chinese covers literal UI messages and never introduces an unknown placeholder", () => {
  const messages: Record<string, string> = JSON.parse(readFileSync(new URL("../lib/locales/zh-CN.json", import.meta.url), "utf8"));
  for (const name of ["openjutsu", "welcome", "from-picture", "object-placement"]) {
    const source = readFileSync(new URL(`../components/${name}.tsx`, import.meta.url), "utf8");
    for (const match of source.matchAll(/\bt\(("(?:[^"\\]|\\.)*")/g)) {
      const key: string = JSON.parse(match[1]);
      assert.ok(Object.hasOwn(messages, key.trim()), `${name}: ${key}`);
    }
  }
  for (const [key, value] of Object.entries(messages)) {
    assert.ok(value.length, key);
    const placeholders = new Set([...key.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
    for (const match of value.matchAll(/\{(\w+)\}/g)) assert.ok(placeholders.has(match[1]), `${key}: ${match[1]}`);
  }
});
