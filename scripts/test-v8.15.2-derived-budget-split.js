"use strict";

const assert = require("assert");
const { Memory4DerivedService, YEAR_MAX_TOKENS, LIFE_SEGMENT_MAX_TOKENS } = require("../resources/app/out/main/memory-system/memory4-derived");

const scope = { campaignToken: "budget-fixture-campaign", ownerId: 2 };
const task = { cancelled: false, controller: { signal: null } };

function eventEntry(entryId, text = "source fact") {
  return {
    entryId, text, importance: 1, entityIds: [], topics: [],
    evidence: { sourceType: "fact", epistemicStatus: "reported" },
    state: { status: "active" },
    eventTime: { from: "1164.1.1", to: "1164.12.31", precision: "year", status: "reported" },
    acquiredDate: "1164.1.1"
  };
}

function acquiredEntry(entryId, acquiredDate, text = "source fact") {
  return {
    entryId, text, importance: 1, entityIds: [], topics: [],
    evidence: { sourceType: "fact", epistemicStatus: "reported" },
    state: { status: "active" },
    eventTime: { from: null, to: null, precision: "unknown", status: "unknown" },
    acquiredDate
  };
}

function sourceItem(entry, text = entry.text) {
  return { itemId: `item_${entry.entryId}`, text, sourceEntryIds: [entry.entryId], entityIds: [], topics: [], importance: 1 };
}

function fixture(responseText) {
  const calls = [];
  const service = new Memory4DerivedService({ store: {}, baseStore: {} });
  service.configure({
    estimateTokens: text => text.length,
    requestCompression: async (prompt, options) => {
      calls.push({ prompt, options });
      const input = JSON.parse(prompt[1].content);
      return JSON.stringify({ items: [{ text: responseText, sourceEntryIds: input.items.flatMap(item => item.sourceEntryIds) }] });
    }
  });
  return { service, calls };
}

async function run() {
  const cases = [];
  const check = async (name, fn) => {
    try { await fn(); cases.push({ name, passed: true }); }
    catch (error) { cases.push({ name, passed: false, error }); }
  };

  await check("YEAR hard limit is 1500 while LIFE segment hard limit stays 1000", async () => {
    assert.equal(YEAR_MAX_TOKENS, 1500);
    assert.equal(LIFE_SEGMENT_MAX_TOKENS, 1000);
  });

  await check("YEAR input at 1400 tokens bypasses compression", async () => {
    const entry = eventEntry("year_skip", "s".repeat(1400));
    const { service, calls } = fixture("compressed");
    const items = [sourceItem(entry)];
    const result = await service.compress(scope, "year", items, [entry], task, null);
    assert.strictEqual(result, items);
    assert.equal(calls.length, 0);
  });

  await check("YEAR 1200-token compressed output is accepted with the YEAR prompt budget", async () => {
    const entry = eventEntry("year_output", "s".repeat(1800));
    const { service, calls } = fixture("y".repeat(1200));
    const result = await service.compress(scope, "year", [sourceItem(entry)], [entry], task, null);
    assert.equal(result[0].text.length, 1200);
    assert.equal(calls.length, 1);
    const prompt = calls[0].prompt[0].content;
    assert.match(prompt, /fit 1200 tokens and never exceed 1500/i);
    assert.equal(calls[0].options.maxTokens, 4096);
    assert.equal(calls[0].options.requestType, "memory4_year");
  });

  await check("YEAR output at 1500 tokens is accepted and 1501 is rejected", async () => {
    const entry = eventEntry("year_boundary", "s".repeat(1800));
    const accepted = fixture("y".repeat(1500));
    const result = await accepted.service.compress(scope, "year", [sourceItem(entry)], [entry], task, null);
    assert.equal(result[0].text.length, 1500);
    const rejected = fixture("y".repeat(1501));
    await assert.rejects(rejected.service.compress(scope, "year", [sourceItem(entry)], [entry], task, null),
      error => error.message === "memory4_compression_quality_failed");
  });

  await check("LIFE input above 1000 compresses to its 700-token soft target", async () => {
    const entry = eventEntry("life_input", "s".repeat(1200));
    const { service, calls } = fixture("l".repeat(700));
    const result = await service.compress(scope, "life", [sourceItem(entry)], [entry], task, null);
    assert.equal(result[0].text.length, 700);
    assert.equal(calls.length, 1);
    const prompt = calls[0].prompt[0].content;
    assert.match(prompt, /fit 700 tokens and never exceed 1000/i);
    assert.equal(calls[0].options.maxTokens, 4096);
    assert.equal(calls[0].options.requestType, "memory4_life");
  });

  await check("LIFE output at 1001 tokens fails closed", async () => {
    const entry = eventEntry("life_over", "s".repeat(1200));
    const { service } = fixture("l".repeat(1001));
    await assert.rejects(service.compress(scope, "life", [sourceItem(entry)], [entry], task, null),
      error => error.message === "memory4_compression_quality_failed");
  });

  await check("Year acquisition labels are retained after compression", async () => {
    const first = acquiredEntry("acquired_1", "1164.1.1", "获知旧事一。" + "detail。".repeat(500));
    const second = acquiredEntry("acquired_2", "1164.2.1", "获知旧事二。" + "detail。".repeat(500));
    const label = "【本年获知，事件日期未知；获知日期：1164.1.1】";
    const { service } = fixture(`${label}压缩事实，否定条件仍须保留。`);
    const items = [sourceItem(first, `${label}${first.text}`),
      sourceItem(second, "【本年获知，事件日期未知；获知日期：1164.2.1】" + second.text)];
    const result = await service.compress(scope, "year", items, [first, second], task, null);
    assert.deepEqual(result[0].sourceEntryIds, ["acquired_1", "acquired_2"]);
    assert.equal(result[0].timeAxis, "acquired");
    assert.equal(result[0].text, "【本年获知，事件日期未知；获知日期：1164.1.1、1164.2.1】压缩事实，否定条件仍须保留。");
  });

  await check("YEAR token check runs again after merged acquisition dates are annotated", async () => {
    const first = acquiredEntry("annotation_1", "1164.1.1");
    const second = acquiredEntry("annotation_2", "1164.2.1");
    const oneDateLabel = "【本年获知，事件日期未知；获知日期：1164.1.1】";
    const response = oneDateLabel + "x".repeat(1500 - oneDateLabel.length);
    const items = [sourceItem(first, `${oneDateLabel}${"a".repeat(900)}`),
      sourceItem(second, `【本年获知，事件日期未知；获知日期：1164.2.1】${"b".repeat(900)}`)];
    const { service } = fixture(response);
    await assert.rejects(service.compress(scope, "year", items, [first, second], task, null),
      error => error.message === "memory4_compression_quality_failed");
  });

  const failures = cases.filter(item => !item.passed);
  for (const item of cases) console.log(`${item.passed ? "PASS" : "FAIL"} ${item.name}${item.error ? `: ${item.error.message}` : ""}`);
  if (failures.length) process.exitCode = 1;
  else console.log(`All ${cases.length} derived budget checks passed.`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
