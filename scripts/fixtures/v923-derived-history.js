"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { assertScope, hash } = require("../../resources/app/out/main/memory-system/memory4-contract");
const { normalizeGameDate } = require("../../resources/app/out/main/worldline/character-temporal-facts");

function eventYears(entry) {
  const first = normalizeGameDate(entry.eventTime?.from);
  const last = normalizeGameDate(entry.eventTime?.to);
  if (!first || !last) return [];
  return Array.from({ length: last.year - first.year + 1 }, (_, index) => first.year + index);
}

// Seed historical artifacts directly; never restore the retired production service.
function seedDerivedHistory(engine, scope, { yearKeys = null, yearTextFor = entry => entry.text } = {}) {
  const memory4 = engine.memory4 || engine;
  assertScope(scope);
  const directory = memory4.store.directory(scope);
  const index = memory4.store.loadIndex(scope);
  const metadata = memory4.store.read(path.join(directory, "metadata.json"), null);
  const entries = memory4.store.query(scope).filter(entry =>
    memory4.sourceValid(scope, index.entries[entry.entryId], index, metadata));
  assert(entries.length, "historical fixture requires valid canonical sources");
  const archiveYears = entry => eventYears(entry).length ? eventYears(entry)
    : [normalizeGameDate(entry.acquiredDate)?.year];
  const years = [...new Set(entries.flatMap(archiveYears).filter(Boolean))]
    .filter(year => !yearKeys || yearKeys.includes(year)).sort((left, right) => left - right);
  fs.mkdirSync(path.join(directory, "years"), { recursive: true });
  const views = years.map(eventYear => {
    const sources = entries.filter(entry => archiveYears(entry).includes(eventYear));
    const view = {
      memory4SchemaVersion: 1, ...scope, eventYear, revision: 1, dirty: false,
      generationMode: "auto", manual: { mode: "auto", editedAt: null }, tokens: 1,
      sourceRevisionSet: sources.map(entry => `${entry.entryId}@${entry.revision}`),
      sourceHash: hash(sources.map(entry => [entry.entryId, entry.revision])),
      items: sources.map(entry => ({
        itemId: `year_item_${hash([eventYear, entry.entryId])}`, text: yearTextFor(entry, eventYear),
        sourceEntryIds: [entry.entryId], entityIds: entry.entityIds, topics: entry.topics,
        importance: entry.importance, timeAxis: eventYears(entry).length ? "event" : "acquired"
      }))
    };
    fs.writeFileSync(path.join(directory, "years", `${eventYear}.json`), JSON.stringify(view));
    return view;
  });
  const life = {
    memory4SchemaVersion: 1, ...scope, revision: 1, dirty: false,
    generationMode: "auto", manual: { mode: "auto", editedAt: null },
    sourceRevisionSet: entries.map(entry => `${entry.entryId}@${entry.revision}`),
    sourceHash: hash(entries.map(entry => [entry.entryId, entry.revision])),
    segments: views.map(view => ({
      segmentId: `life_${view.eventYear}`, period: { fromYear: view.eventYear, toYear: view.eventYear },
      text: view.items.map(item => item.text).join("\n"),
      sourceEntryIds: view.items.flatMap(item => item.sourceEntryIds),
      sourceYearItemIds: view.items.map(item => `${view.eventYear}:${item.itemId}`), items: view.items
    }))
  };
  fs.writeFileSync(path.join(directory, "life.json"), JSON.stringify(life));
  return { years: views, life };
}

module.exports = { seedDerivedHistory };
