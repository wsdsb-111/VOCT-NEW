"use strict";

const assert = require("assert");

const { source, assertMappedCopy, assertCopy } = require("./world-memory-i18n-test-helper");
assert.match(source, /LOAD_BOUNDARY_CANDIDATE/);
assertCopy('copy("branch.newLoadSession", "检测到新的 CK3 载入会话"', "branch.newLoadSession", "检测到新的 CK3 载入会话", "A new CK3 load session was detected");
assertCopy('copy("branch.loadBoundaryHelp", "检测到 CK3 重新载入或新的游戏会话。', "branch.loadBoundaryHelp", "检测到 CK3 重新载入或新的游戏会话。请明确选择继续当前分支，或建立不继承旧 Canon 的独立分支；系统不会自动把两段存档接在一起。", "CK3 was reloaded or a new session started. Choose whether to continue this branch or create an independent branch without old Canon; the sessions will not be joined automatically.");
assertMappedCopy("继续当前分支", "branch.continueCurrent", "继续当前分支", "Continue current branch");
assertMappedCopy("建立独立分支（不继承旧 Canon）", "branch.createIndependent", "建立独立分支（不继承旧 Canon）", "Create an independent branch (do not inherit old Canon)");
assert.match(source, /branchNeedsAction = .*LOAD_BOUNDARY_CANDIDATE/);
console.log("V8.7.2 load-boundary player UI PASS");
