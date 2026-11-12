import english from "./i18n-en.json";

export type Locale = "zh-CN" | "en";
export type LanguagePreference = Locale | "system";

const translations: Readonly<Record<string, string>> = english;
export function resolveLocale(preference: unknown, systemLanguage: string): Locale {
  if (preference === "en" || preference === "zh-CN") return preference;
  return /^zh(?:-|$)/i.test(systemLanguage) ? "zh-CN" : "en";
}

// The desktop app has a single main window. Set its locale when applying app state
// so both renders and callbacks registered before a language change use the same locale.
let locale = resolveLocale("system", navigator.language);

export function setLocale(value: unknown) {
  locale = resolveLocale(value, navigator.language);
  document.documentElement.lang = locale;
}

export function getLocale() {
  return locale;
}

export function tr(source: string, ...values: unknown[]): string {
  const message = locale === "en" && Object.hasOwn(translations, source)
    ? translations[source]
    : source;
  return values.length
    ? message.replace(/\{(\d+)\}/g, (match, index) =>
        Number(index) < values.length ? String(values[Number(index)]) : match,
      )
    : message;
}

/** Localize known diagnostics while preserving external messages and technical details. */
export function trDiagnostic(source: string): string {
  if (locale !== "en") return source;
  const errorPrefix = "Error: ";
  if (source.startsWith(errorPrefix))
    return errorPrefix + trDiagnostic(source.slice(errorPrefix.length));
  const position = /^(.*)（位置 (\d+)）$/.exec(source);
  if (position) return tr("{0}（位置 {1}）", tr(position[1]), position[2]);
  const lora = /^无法核对模型标识：(.*)；整批未添加$/s.exec(source);
  if (lora) return tr("无法核对模型标识：{0}；整批未添加", lora[1]);
  const detail = /^([^：]+(?:：| · code | · ))(.+)$/s.exec(source);
  if (detail && Object.hasOwn(translations, detail[1] + "{0}"))
    return tr(detail[1] + "{0}", trDiagnostic(detail[2]));
  return tr(source);
}
