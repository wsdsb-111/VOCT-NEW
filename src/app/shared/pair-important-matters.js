(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.VOTCPairImportantMatters = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const TITLE = /【[ \t\r\n\u00a0\u3000]*需[ \t\r\n\u00a0\u3000]*要[ \t\r\n\u00a0\u3000]*长[ \t\r\n\u00a0\u3000]*期[ \t\r\n\u00a0\u3000]*记[ \t\r\n\u00a0\u3000]*住[ \t\r\n\u00a0\u3000]*的[ \t\r\n\u00a0\u3000]*事[ \t\r\n\u00a0\u3000]*项[ \t\r\n\u00a0\u3000]*】/u;
  const NEXT_TITLE = /【[^】\r\n]{1,80}】/u;
  const EMPTY_VALUES = new Set(["无", "无特别事项", "没有需要长期记住的事项"]);
  const BULLET = /^\s*(?:[-•*]|\d{1,3}[.)、]|[（(](?:\d{1,3}|[一二三四五六七八九十百千]+)[）)])\s*/u;

  function cleanLine(value) {
    return String(value || "").replace(/\t/g, " ").trim();
  }

  function cleanItemLines(lines) {
    return lines.map(cleanLine).filter(Boolean).join("\n");
  }

  function parseImportantMatters(content) {
    if (typeof content !== "string") {
      return { status: "INVALID_CONTENT", items: [], diagnostics: { reason: "SUMMARY_CONTENT_INVALID" } };
    }

    const title = TITLE.exec(content);
    if (!title) return { status: "NO_TITLE", items: [], diagnostics: { reason: "IMPORTANT_MATTERS_TITLE_MISSING" } };

    const sectionStart = title.index + title[0].length;
    const remainder = content.slice(sectionStart);
    const nextTitle = NEXT_TITLE.exec(remainder);
    const section = nextTitle ? remainder.slice(0, nextTitle.index) : remainder;
    const normalizedSection = section.replace(/\r\n?/g, "\n").trim();
    if (!normalizedSection) return { status: "NO_IMPORTANT_MATTERS", items: [], diagnostics: { reason: "IMPORTANT_MATTERS_EMPTY" } };
    if (EMPTY_VALUES.has(normalizedSection.replace(/[ \t\n\u00a0\u3000]+/g, " ").trim())) {
      return { status: "NO_IMPORTANT_MATTERS", items: [], diagnostics: { reason: "NO_IMPORTANT_MATTERS" } };
    }

    const beforeSection = content.slice(0, sectionStart);
    const firstSectionLine = beforeSection.split(/\r\n|\r|\n/).length;
    const lines = section.replace(/\r\n?/g, "\n").split("\n");
    const markers = lines.map((line, index) => ({ line, index, match: BULLET.exec(line) }));
    const hasBullets = markers.some(entry => entry.match && cleanLine(entry.line.slice(entry.match[0].length)));
    const items = [];

    if (hasBullets) {
      const firstBullet = markers.findIndex(entry => entry.match && cleanLine(entry.line.slice(entry.match[0].length)));
      if (markers.slice(0, firstBullet).some(entry => cleanLine(entry.line))) {
        const text = cleanItemLines(lines);
        return { status: "AMBIGUOUS_ITEM_BOUNDARY", items: [{ text, ordinal: 1,
          sourceLine: firstSectionLine, ambiguous: true }], diagnostics: { reason: "AMBIGUOUS_ITEM_BOUNDARY" } };
      }

      let current = null;
      for (const entry of markers) {
        const marker = entry.match;
        if (marker) {
          if (current) items.push(current);
          current = { lines: [entry.line.slice(marker[0].length)], sourceLine: firstSectionLine + entry.index };
        } else if (current) {
          current.lines.push(entry.line);
        } else if (cleanLine(entry.line)) {
          current = { lines: [entry.line], sourceLine: firstSectionLine + entry.index };
        }
      }
      if (current) items.push(current);
      const normalizedItems = items.map((item, index) => ({
        text: cleanItemLines(item.lines),
        ordinal: index + 1,
        sourceLine: item.sourceLine,
        ambiguous: false
      })).filter(item => item.text);
      return { status: normalizedItems.length ? "PARSED" : "NO_IMPORTANT_MATTERS", items: normalizedItems,
        diagnostics: normalizedItems.length ? {} : { reason: "IMPORTANT_MATTERS_EMPTY" } };
    }

    const paragraphs = normalizedSection.split(/\n\s*\n/u).filter(value => value.trim());
    const text = cleanItemLines(lines);
    const ambiguous = paragraphs.length > 1;
    return {
      status: ambiguous ? "AMBIGUOUS_ITEM_BOUNDARY" : "PARSED",
      items: text ? [{ text, ordinal: 1, sourceLine: firstSectionLine, ambiguous }] : [],
      diagnostics: ambiguous ? { reason: "AMBIGUOUS_ITEM_BOUNDARY" } : {}
    };
  }

  function normalizedSearchText(value) {
    if (typeof value !== "string") return "";
    return value.normalize("NFKC").toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function searchTerms(value) {
    const normalized = normalizedSearchText(value);
    if (!normalized) return [];
    const terms = new Set();
    for (const match of normalized.matchAll(/[\p{Script=Han}]+|(?:(?!\p{Script=Han})[\p{L}\p{N}])+/gu)) {
      const token = match[0];
      if (/^\p{Script=Han}+$/u.test(token)) {
        for (const size of [2, 3]) {
          for (let index = 0; index + size <= token.length; index++) terms.add(token.slice(index, index + size));
        }
      } else {
        terms.add(token);
      }
    }
    return [...terms];
  }

  return { parseImportantMatters, normalizedSearchText, searchTerms };
});
