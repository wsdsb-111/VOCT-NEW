"use strict";

function values(value) {
  if (Array.isArray(value)) return value;
  return value === null || value === undefined || value === "" ? [] : [value];
}

function normalizeRecord(value, relationType, source, allowPrimitiveId) {
  const object = value && typeof value === "object" ? value : null;
  const rawId = object?.id ?? object?.characterId ?? (allowPrimitiveId ? value : null);
  const numericId = Number(rawId);
  const runtimeId = rawId !== null && rawId !== undefined && rawId !== "" && Number.isFinite(numericId) ? numericId : null;
  const name = String(object?.fullName || object?.shortName || object?.firstName || object?.name || (object || runtimeId !== null ? "" : value) || "").trim() || null;
  const hasDeathTotalDays = object?.deathDateTotalDays !== null && object?.deathDateTotalDays !== undefined && object?.deathDateTotalDays !== "" && Number.isFinite(Number(object.deathDateTotalDays));
  const deceased = object?.alive === false || !!object?.deathDate || hasDeathTotalDays;
  return {
    runtimeId,
    name,
    relationType: deceased ? "DECEASED_SPOUSE" : relationType,
    alive: deceased ? false : object?.alive ?? null,
    deathDate: object?.deathDate || null,
    deathDateTotalDays: hasDeathTotalDays ? Number(object.deathDateTotalDays) : null,
    source,
    confidence: runtimeId === null ? 0.4 : 1,
    raw: object || value
  };
}

function normalizeSpouseRecords(character = {}) {
  const records = [];
  const add = (value, relationType, source, allowPrimitiveId = true) => {
    for (const item of values(value)) {
      const record = normalizeRecord(item, relationType, source, allowPrimitiveId);
      if (!record.name && record.runtimeId === null) continue;
      const key = `${record.runtimeId ?? "name"}:${record.name || ""}:${record.relationType}`;
      if (!records.some((entry) => entry.key === key)) records.push({ ...record, key });
    }
  };
  add(character.spouses, "CURRENT_SPOUSE", "spouses");
  add(character.spouse, "CURRENT_SPOUSE", "spouse");
  add(character.formerSpouses, "FORMER_SPOUSE", "formerSpouses");
  add(character.deceasedSpouses, "DECEASED_SPOUSE", "deceasedSpouses");
  add(character.consort, "UNKNOWN_CONSORT", "consort", false);
  return records.map(({ key, ...record }) => record);
}

module.exports = { normalizeSpouseRecords };
