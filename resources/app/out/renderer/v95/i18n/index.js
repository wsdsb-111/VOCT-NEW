import zhCN from "./locales/zh-CN.js";
import enUS from "./locales/en-US.js";
import v951LegacyUi from "./locales/v9-5-1-legacy-ui.js";

export const UI_LANGUAGES = Object.freeze(["zh-CN", "en-US"]);
export const UI_CATALOGS = Object.freeze({
  "zh-CN": Object.freeze({ ...zhCN, legacyUiV951: v951LegacyUi["zh-CN"] }),
  "en-US": Object.freeze({ ...enUS, legacyUiV951: v951LegacyUi["en-US"] })
});
export function normalizeUiLanguage(value) {
  return UI_LANGUAGES.includes(value) ? value : "zh-CN";
}

export function createUiTranslator(i18n, language) {
  const locale = normalizeUiLanguage(language);
  for (const code of UI_LANGUAGES) i18n.addResourceBundle(code, "v95", UI_CATALOGS[code], true, true);
  const translate = i18n.getFixedT(locale, "v95");
  return (key, params = {}) => {
    const localValue = typeof key === "string" ? key.split(".").reduce((value, part) => Object.hasOwn(value || {}, part) ? value[part] : undefined, UI_CATALOGS[locale]) : undefined;
    const value = typeof localValue === "string" ? translate(key, params) : null;
    return typeof value === "string" && value && value !== key && !value.includes("{{") ? value : UI_CATALOGS[locale].common.unavailable;
  };
}
