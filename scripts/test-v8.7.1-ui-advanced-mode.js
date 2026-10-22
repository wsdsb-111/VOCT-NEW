"use strict";

const assert = require("assert");

const { source, assertCopy, assertMappedCopy } = require("./world-memory-i18n-test-helper");
assertCopy('copy("developer.record", "Record: {{id}}"', "developer.record", "记录：{{id}}", "Record: {{id}}");
assertCopy('copy("developer.recordBranch", "Branch: {{branch}} · Revision: {{revision}}"', "developer.recordBranch", "分支：{{branch}} · 修订：{{revision}}", "Branch: {{branch}} · Revision: {{revision}}");
assertCopy('copy("developer.conflictKey", "冲突标识：{{value}}"', "developer.conflictKey", "冲突标识：{{value}}", "Conflict key: {{value}}");
assertCopy('copy("form.keepInConversation", "在本次对话中持续提醒 NPC"', "form.keepInConversation", "在本次对话中持续提醒 NPC", "Keep reminding NPCs in this conversation");
assertCopy('copy("developer.entitiesRuntimeId", "涉及人物 Runtime ID：{{ids}}"', "developer.entitiesRuntimeId", "涉及人物 Runtime ID：{{ids}}", "Character Runtime IDs: {{ids}}");
assertCopy('copy("developer.knownByRuntimeId", "知情人物 Runtime ID：{{ids}}"', "developer.knownByRuntimeId", "知情人物 Runtime ID：{{ids}}", "Informed character Runtime IDs: {{ids}}");
assertMappedCopy("开发者详情", "ui.developerDetails", "开发者详情", "Developer details");
assert.match(source, /developerMode && h\("details", \{ className: "world-memory-developer" \}/, "developer-only diagnostics must remain hidden outside developer mode");
assert.match(source, /h\("details", \{ className: "world-memory-advanced" \}/, "advanced controls remain inside a collapsed details section");
assert.match(source, /setHistory\(previous => previous \? \{ \.\.\.previous, offset, records: \[\.\.\.previous\.records, \.\.\.records\]/);
console.log("V8.7.1 Luna advanced mode UI PASS");
