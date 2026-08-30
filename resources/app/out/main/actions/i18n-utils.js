"use strict";

function resolveI18nString(value, lang) {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    if (lang && value[lang]) return value[lang];
    if (value.en) return value.en;
    const keys = Object.keys(value);
    if (keys.length > 0) return value[keys[0]];
  }
  return "";
}

module.exports = { resolveI18nString };
