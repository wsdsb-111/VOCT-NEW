"use strict";

const { normalizeGameDate } = require("../worldline/character-temporal-facts");

function resolvedName(snapshot, id) {
  const person = snapshot.characters?.[String(id)];
  return person?.fullName || person?.firstName || null;
}

function resolvedTitle(snapshot, id, localize) {
  const title = snapshot.titles?.[String(id)];
  if (!title) return null;
  if (title.displayName) return title.displayName;
  const result = title.key ? localize?.("title", title.key) : null;
  return result && /^(CONFIRMED|DISPLAY_LITERAL)/.test(result.confidence || "") ? result.localizedValue : null;
}

function renderOfficialMemory(memory, snapshot, localize = null) {
  const date = normalizeGameDate(memory.creationDate);
  if (!date) return { status: "UNRESOLVED_CK3_MEMORY", reason: "DATE_UNAVAILABLE" };
  const variables = new Map((memory.variables || []).map((item) => [item.flag, item]));
  const character = (id) => resolvedName(snapshot, id);
  const title = (id) => resolvedTitle(snapshot, id, localize);
  let body = null;
  let renderer = "safe_fallback";
  switch (memory.memoryType) {
    case "became_friends": {
      const other = character(memory.participants?.new_relation);
      if (other) body = `我与${other}成为朋友。`;
      break;
    }
    case "imprisoned": {
      const captor = character(memory.participants?.imprisoner);
      if (captor) body = `我曾被${captor}囚禁。`;
      break;
    }
    case "lost_title_memory": {
      const holder = character(memory.participants?.new_holder);
      const lostTitle = title(variables.get("landed_title")?.identity);
      if (holder && lostTitle) body = `我失去了${lostTitle}，其后由${holder}持有。`;
      else if (holder) body = `我曾失去头衔，其后由${holder}持有；具体头衔未解析。`;
      break;
    }
    case "joined_allys_war": {
      const ally = character(memory.participants?.ally);
      const enemy = character(memory.participants?.enemy);
      if (ally && enemy) body = `我曾与${ally}一同参战，对阵${enemy}。`;
      break;
    }
    default: {
      const localized = localize?.("memory", memory.memoryType);
      if (localized && /^(CONFIRMED|DISPLAY_LITERAL)/.test(localized.confidence || "") && localized.localizedValue !== memory.memoryType && !/\$[^$]+\$|\[[^\]]+\]/u.test(localized.localizedValue)) {
        body = localized.localizedValue;
        renderer = localized.sourceMod ? "mod_localization" : "ck3_localization";
      }
    }
  }
  if (!body) return { status: "UNRESOLVED_CK3_MEMORY", reason: "STRUCTURE_OR_LOCALIZATION_UNAVAILABLE" };
  return { status: "RENDERED", memoryId: memory.memoryId, memoryType: memory.memoryType,
    creationDate: date.canonical, endDate: memory.endDate || null, renderedText: `${date.display}：${body}`, renderer };
}

module.exports = { renderOfficialMemory };
