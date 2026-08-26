"use strict";

const CJK_CHARACTER_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;

function estimateTokens(text) {
  if (text == null || text === "") return 0;
  const value = String(text);
  const cjkCharacters = (value.match(CJK_CHARACTER_PATTERN) || []).length;
  return Math.ceil(cjkCharacters * 0.8 + (value.length - cjkCharacters) / 4);
}

module.exports = { estimateTokens };
