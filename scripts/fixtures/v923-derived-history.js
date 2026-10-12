"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { assertScope, hash, ids, strings } = require("../../resources/app/out/main/memory-system/memory4-contract");
const { eventYears } = require("../../resources/app/out/main/memory-system/memory4-derived");
const { normalizeGameDate } = require("../../resources/app/out/main/worldline/character-temporal-facts");

function archiveYears(entry) {
  const years = eventYears(entry);
  if (years.length) return years;
  const time = entry.eventTime;
  if (!time || time.from || time.to || time.precision !== "unknown"
    || !["unknown", "observed", "reported"].includes(time.status)) return [];
  const acquired = normalizeGameDate(entry.acquiredDate);
  return acquired ? [acquired.year] : [];
}

function seedDerivedHistory(engine, scope, { yearKeys: requestedYearKeys = null, yearTextFor = entry => entry.text } = {}) {
  const memory4 = engine.memory4 || engine;
  const { derived, store } = memory4;
  scope = { campaignToken: scope?.campaignToken, ownerId: scope?.ownerId };
  assertScope(scope);
  const index = store.loadIndex(scope);
  const metadata = store.read(path.join(store.directory(scope), "metadata.json"), null);
  const allSources = derived.snapshot(scope, {}, index);
  assert(allSources.entryIds.length, "historical Derived fixture requires committed canonical sources");

  const entries = new Map();
  for (const entryId of allSources.entryIds) {
    const row = index.entries[entryId];
    const finalization = row && index.finalizations[hash(row.finalizationId)];
    assert(row && finalization?.status === "STORE" && finalization.entryIds?.includes(entryId),
      "historical Derived fixture requires a committed Durable indexed source");
    assert.equal(finalization.sourceRevision, metadata?.knownEvidenceRevisions?.[hash([row.conversationId, scope.ownerId])],
      "historical Derived fixture requires current source revision evidence");
    assert(derived.sourceValid(scope, row, index, metadata), "historical Derived fixture source must pass production visibility and Forget checks");
    entries.set(entryId, store.readEntry(scope, entryId, index));
  }

  const availableYears = [...new Set([...entries.values()].flatMap(archiveYears))].sort((a, b) => a - b);
  const years = requestedYearKeys ? availableYears.filter(year => requestedYearKeys.includes(year)) : availableYears;
  assert(years.length, "historical Derived fixture requires at least one source-backed Year view");
  const yearViews = [];
  for (const eventYear of years) {
    const snapshot = derived.snapshot(scope, { eventYear }, index);
    const items = snapshot.entryIds.map(entryId => {
      const entry = entries.get(entryId);
      const eventDated = eventYears(entry).length > 0;
      const acquiredDate = normalizeGameDate(entry.acquiredDate)?.canonical;
      const sourceText = String(yearTextFor(entry, eventYear) || entry.text).trim();
      const text = eventDated ? sourceText : `【本年获知，事件日期未知；获知日期：${acquiredDate}】${sourceText}`;
      return {
        itemId: `year_item_${hash([eventYear, entryId])}`,
        text,
        sourceEntryIds: [entryId],
        entityIds: [...entry.entityIds],
        topics: [...entry.topics],
        importance: entry.importance,
        timeAxis: eventDated ? "event" : "acquired"
      };
    });
    const view = {
      memory4SchemaVersion: 1,
      ...scope,
      eventYear,
      revision: 1,
      dirty: false,
      generationMode: "auto",
      sourceRevisionSet: snapshot.sourceRevisionSet,
      sourceHash: snapshot.sourceHash,
      items,
      manual: { mode: "auto", editedAt: null },
      tokens: Math.ceil(items.map(item => item.text).join("\n").length / 4)
    };
    derived.persist(scope, "year", view);
    yearViews.push(view);
  }

  const segments = [];
  const decades = [...new Set(years.map(year => Math.floor(year / 10) * 10))];
  for (const decade of decades) {
    const period = { fromYear: decade, toYear: decade + 9 };
    const sources = derived.snapshot(scope, { period }, index);
    const sourceYears = yearViews.filter(view => view.eventYear >= decade && view.eventYear <= decade + 9);
    const items = sourceYears.flatMap(view => view.items.map(item => ({ ...item,
      sourceYearItemId: `${view.eventYear}:${item.itemId}` })));
    segments.push({
      segmentId: `life_${decade}s`,
      period,
      text: items.map(item => item.text).join("\n"),
      sourceYearItemIds: strings(items.map(item => item.sourceYearItemId)),
      sourceEntryIds: strings(items.flatMap(item => item.sourceEntryIds)),
      entityIds: ids(items.flatMap(item => item.entityIds)),
      topics: strings(items.flatMap(item => item.topics)),
      items,
      sourceRevisionSet: sources.sourceRevisionSet,
      sourceHash: sources.sourceHash,
      sourceYears: sourceYears.map(view => ({ eventYear: view.eventYear, viewHash: hash(view) })),
      manual: { mode: "auto", editedAt: null }
    });
  }

  const life = {
    memory4SchemaVersion: 1,
    ...scope,
    revision: 1,
    dirty: false,
    sourceRevisionSet: allSources.sourceRevisionSet,
    sourceHash: allSources.sourceHash,
    yearStamp: hash(yearViews.map(view => [view.eventYear, view.revision, view.sourceHash, view.items])),
    segments,
    generationMode: "auto",
    manual: { mode: "auto", editedAt: null }
  };
  derived.persist(scope, "life", life);

  const listed = derived.list(scope);
  assert.equal(listed.generationPolicy, "RETIRED");
  assert(listed.years.every(view => !view.dirty), "seeded historical Year files must pass current source validation");
  assert(!listed.life?.dirty, "seeded historical Life file must pass current source validation");
  return { years: listed.years, life: listed.life };
}

module.exports = { seedDerivedHistory };
