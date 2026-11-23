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

function splitResponderCharacterProfile(description, responderId, items) {
  const fallback = { profile: "", live: description };
  if (typeof description !== "string" || responderId == null || String(responderId).trim() === "" || !Array.isArray(items) || !items.length) return fallback;
  if (items.some(item => typeof item !== "string")) return fallback;
  const idMatch = /^id\(([^()\r\n]+)\)$/.exec(items[0]);
  if (!idMatch || idMatch[1] !== String(responderId)) return fallback;

  const itemStart = description.indexOf(items[0]);
  if (itemStart < 1) return fallback;
  const heading = description.slice(0, itemStart);
  if (heading[0] !== "[" || /[\r\n\[\]]/.test(heading.slice(1)) || (!heading.endsWith("'s character info: ") && !heading.endsWith("的角色信息："))) return fallback;

  const responderSection = `${heading}${items.join("; \n")}]`;
  if (!description.startsWith(responderSection) || !description.slice(responderSection.length).startsWith("\n")) return fallback;

  const stableItem = /^(?:personality traits|sexuality|personality|personality_core|faith|culture): |(?:性格特质|性取向|性格|性格核心|信仰|文化)：/;
  const profileItems = items.filter(item => stableItem.test(item));
  if (!profileItems.length || profileItems.some(item => /[\[\]]/.test(item))) return fallback;
  const liveItems = items.filter(item => !stableItem.test(item));
  const profile = `${heading}${profileItems.join("; \n")}]`;
  const liveSection = liveItems.length ? `${heading}${liveItems.join("; \n")}]` : "";
  return { profile, live: `${liveSection}${description.slice(responderSection.length)}` };
}

module.exports = { splitCharacterProfile, splitResponderCharacterProfile };
