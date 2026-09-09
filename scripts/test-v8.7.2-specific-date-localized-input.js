"use strict";

const assert = require("assert");
const { create, createCanonFixture } = require("./v8.7.1-canon-test-fixture");
const { normalizeCanonPayload } = require("../resources/app/out/main/worldline/canon-contract");

(async () => {
  const fixture = createCanonFixture();
  try {
    const specific = await create(fixture.service, { title: "中文指定日期", content: "这件事在指定日期发生", temporalMode: "SPECIFIC_DATE", gameDate: "1175年8月23日" });
    assert.equal(specific.gameDate, "1175.8.23");
    const canonical = await create(fixture.service, { title: "标准指定日期", content: "这件事也使用标准日期", temporalMode: "SPECIFIC_DATE", gameDate: "1175.8.24" });
    assert.equal(canonical.gameDate, "1175.8.24");
    const planned = await create(fixture.service, { title: "中文计划日期", content: "下月再议", temporalMode: "PLANNED", gameDate: "1175年9月1日", type: "PLANNED_DECISION" });
    assert.equal(planned.gameDate, "1175.9.1");
    const undatedPlan = await create(fixture.service, { title: "未定计划日期", content: "日期尚未确定", temporalMode: "PLANNED", gameDate: null, type: "PLANNED_DECISION" });
    assert.equal(undatedPlan.gameDate, null);
    const timeless = await create(fixture.service, { title: "无日期规则", content: "长期遵守这条规则", temporalMode: "TIMELESS", type: "WORLD_ANNOTATION" });
    assert.equal(timeless.gameDate, null);
    assert.equal(timeless.totalDays, null);
    assert.throws(() => normalizeCanonPayload({ title: "坏的指定日期", content: "拒绝", temporalMode: "SPECIFIC_DATE", gameDate: "1175年2月31日" }, { gameDate: "1175.1.1" }), /supplemental_specific_date_invalid/);
    assert.throws(() => normalizeCanonPayload({ title: "坏的计划日期", content: "拒绝", temporalMode: "PLANNED", gameDate: "1175年13月1日" }, { gameDate: "1175.1.1" }), /supplemental_planned_date_invalid/);
    assert.throws(() => normalizeCanonPayload({ title: "坏的当前日期", content: "拒绝" }, { gameDate: "1175年2月31日" }), /supplemental_current_date_invalid/);
    console.log("V8.7.2 SPECIFIC_DATE / PLANNED / TIMELESS contract PASS");
  } finally { fixture.dispose(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
