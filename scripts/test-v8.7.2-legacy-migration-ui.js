"use strict";

const assert = require("assert");

const { source, assertMappedCopy, assertCopy } = require("./world-memory-i18n-test-helper");
assert.match(source, /getLegacySupplementalMigration/);
assert.match(source, /migrateLegacySupplemental/);
assert.match(source, /MIGRATION_REVIEW_REQUIRED/);
assertCopy('legacyMigration.requiresReview ? "legacy.reviewTitle"', "legacy.reviewTitle", "迁移审阅", "Review migration");
assertCopy(': "legacy.confirmTitle"', "legacy.confirmTitle", "迁移确认", "Confirm migration");
assertMappedCopy("确认迁移为 Canon", "legacy.confirmMigration", "确认迁移为 Canon", "Confirm migration to Canon");
assert.match(source, /reviewConfirmed: true/);
assertCopy('copy("legacy.knownBy"', "legacy.knownBy", "重新选择明确知情人物", "Select explicitly informed characters again");
assertCopy('copy("legacy.scopePerson"', "legacy.scopePerson", "重新选择范围人物", "Select the scope character again");
console.log("V8.7.2 legacy Supplemental migration UI PASS");
