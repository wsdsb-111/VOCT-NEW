"use strict";
// ARCHIVED V8.15.2: run only against the frozen runtime with the retired Derived service.
const assert = require("node:assert/strict");
const { Memory4DerivedService } = require("../resources/app/out/main/memory-system/memory4-derived");

function makeDerivedFixture(responseText) {
  const calls = [];
  const service = new Memory4DerivedService({ store: {}, baseStore: {} });
  service.configure({
    estimateTokens: text => String(text).length,
    requestCompression: async (messages, options) => {
      calls.push({ messages, options });
      const request = JSON.parse(messages[1].content);
      const sourceEntryIds = request.items.flatMap(item => item.sourceEntryIds);
      return JSON.stringify({ items: [{ text: responseText, sourceEntryIds }] });
    }
  });
  return { service, calls };
}

function derivedEntry(entryId, text) {
  return {
    entryId, text, importance: 1, entityIds: [], topics: [],
    evidence: { sourceType: "fact", epistemicStatus: "reported" },
    state: { status: "active" },
    eventTime: { from: "1164.1.1", to: "1164.12.31", precision: "year", status: "reported" },
    acquiredDate: "1164.1.1"
  };
}

function derivedItem(entry) {
  return { itemId: `item_${entry.entryId}`, text: entry.text, sourceEntryIds: [entry.entryId],
    entityIds: [], topics: [], importance: 1 };
}

async function lifeBudgetRetainsSourcesBetweenYearAndLifeLimits() {
  const first = derivedEntry("life_source_1", "a".repeat(700));
  const second = derivedEntry("life_source_2", "b".repeat(700));
  const { service, calls } = makeDerivedFixture("c".repeat(900));
  const result = await service.compress({ campaignToken: "qa-campaign", ownerId: 2 }, "life",
    [derivedItem(first), derivedItem(second)], [first, second],
    { cancelled: false, controller: { signal: null } }, null);

  assert.equal(calls.length, 1, "1401 LIFE input tokens must compress even though they fit the YEAR cap");
  assert.match(calls[0].messages[0].content, /fit 700 tokens and never exceed 1000/i);
  assert.deepEqual(result[0].sourceEntryIds, [first.entryId, second.entryId], "compressed LIFE output retains each source exactly once");
  assert.equal(result[0].timeAxis, "event");
}

async function lifeHardLimitRejectsOverageAndYearAcceptsItsOwnRange() {
  const entry = derivedEntry("budget_boundary_source", "s".repeat(1800));
  const items = [derivedItem(entry)];
  const lifeOver = makeDerivedFixture("l".repeat(1001));
  await assert.rejects(lifeOver.service.compress({ campaignToken: "qa-campaign", ownerId: 2 }, "life", items, [entry],
    { cancelled: false, controller: { signal: null } }, null), error => error.message === "memory4_compression_quality_failed");

  const yearAllowed = makeDerivedFixture("y".repeat(1450));
  const yearResult = await yearAllowed.service.compress({ campaignToken: "qa-campaign", ownerId: 2 }, "year", items, [entry],
    { cancelled: false, controller: { signal: null } }, null);
  assert.equal(yearAllowed.calls.length, 1);
  assert.equal(yearResult[0].text.length, 1450);
  assert.deepEqual(yearResult[0].sourceEntryIds, [entry.entryId]);

  const lostSource = makeDerivedFixture("z".repeat(900));
  lostSource.service.options.requestCompression = async () => JSON.stringify({ items: [{ text: "compressed", sourceEntryIds: ["wrong_source"] }] });
  await assert.rejects(lostSource.service.compress({ campaignToken: "qa-campaign", ownerId: 2 }, "year", items, [entry],
    { cancelled: false, controller: { signal: null } }, null), error => error.message === "memory4_compression_source_mismatch");
}

async function main() {
  await lifeBudgetRetainsSourcesBetweenYearAndLifeLimits();
  await lifeHardLimitRejectsOverageAndYearAcceptsItsOwnRange();
  console.log("Historical V8.15.2 fix5 Derived budget: PASS");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
