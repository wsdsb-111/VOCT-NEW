"use strict";

// Classify rendered items, retaining their exact text and the existing script's
// privacy/family resolution. Unknown/custom formats are fresh runtime content.
function splitCharacterProfile(description) {
  const fallback = { stableContent: "", dynamicContent: description };
  const headers = [...description.matchAll(/^\[([^\r\n]*?(?:'s character info: |的角色信息：))/gm)];
  if (!headers.length || headers[0].index !== 0) return fallback;
  const scene = /(?:^|\n)\[(?:date|日期)\(/m.exec(description);
  const sceneStart = scene ? scene.index + (description[scene.index] === "\n" ? 1 : 0) : description.length;
  const stable = [];
  const runtime = [];
  const stableItem = /^(?:id\([^\r\n]*\)$|(?:name|full name|personality traits|sexuality|personality|personality_core|faith|culture): |(?:名字|全名|性格特质|性取向|性格|性格核心|信仰|文化)：|(?:man|woman|person), (?:of house |lowborn$))/;
  for (let index = 0; index < headers.length; index++) {
    const start = headers[index].index;
    const end = index + 1 < headers.length ? headers[index + 1].index : sceneStart;
    const section = description.slice(start, end).trimEnd();
    if (!section.endsWith("]")) return fallback;
    const header = headers[index][0];
    const items = section.slice(header.length, -1).split(/; \r?\n/);
    const stableItems = [];
    const runtimeItems = [];
    for (const item of items) (stableItem.test(item) || /^(?:男性|女性|性别未知)，[^\r\n]*(?:家族|平民)$/.test(item) ? stableItems : runtimeItems).push(item);
    if (stableItems.length) stable.push(`${header}${stableItems.join("; \n")}]`);
    if (runtimeItems.length) runtime.push(`${header}${runtimeItems.join("; \n")}]`);
  }
  if (sceneStart < description.length) runtime.push(description.slice(sceneStart));
  return { stableContent: stable.join("\n"), dynamicContent: runtime.join("\n") };
}

module.exports = { splitCharacterProfile };
