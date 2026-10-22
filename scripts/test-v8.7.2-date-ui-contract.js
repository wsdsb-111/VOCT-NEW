"use strict";

const assert = require("assert");

const { source, assertMappedCopy, assertCatalogValue } = require("./world-memory-i18n-test-helper");
assert.match(source, /function isValidGameDateInput\(value\)/);
assert.match(source, /supplemental_specific_date_invalid/);
assert.match(source, /supplemental_planned_date_invalid/);
assert.match(source, /function formatCanonError\(cause, developerMode\)/);
assert.ok(source.includes("supplemental_current_date_invalid:"), "current-date failures must use the stable error code");
assertCatalogValue("errors.supplemental_current_date_invalid", "无法识别当前游戏日期，请刷新存档后重试。", "The current game date could not be read. Refresh the save and try again.");
assertMappedCopy("格式如 1171.9.20 或 1171年9月20日", "form.specificDateHelp", "格式如 1171.9.20 或 1171年9月20日", "For example, 1171.9.20");
assert.match(source, /formatGameDateForDisplay\(record\.gameDate\)/);
console.log("V8.7.2 date UI validation and player-facing errors PASS");
