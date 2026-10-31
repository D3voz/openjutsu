import zhCN from "./locales/zh-CN.json" with { type: "json" };

export type Locale = "en" | "zh-CN";
export type Values = Record<string, string | number>;
export const LANGUAGE_KEY = "openjutsu.language";

export function preferredLocale(saved: string | null, languages: readonly string[]): Locale {
  if (saved === "en" || saved === "zh-CN") return saved;
  for (const language of languages) {
    if (/^zh(?:-|$)/i.test(language)) return "zh-CN";
    if (/^en(?:-|$)/i.test(language)) return "en";
  }
  return "en";
}

export function translate(locale: Locale, message: string, values: Values = {}): string {
  const key = message.trim();
  const translated = locale === "zh-CN" && Object.hasOwn(zhCN, key) ? (zhCN as Record<string, string>)[key] : undefined;
  const text = translated === undefined ? message : message.replace(/\S[\s\S]*\S|\S/, () => translated);
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => Object.hasOwn(values, name) ? String(values[name]) : placeholder);
}
