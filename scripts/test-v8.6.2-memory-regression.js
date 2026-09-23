"use strict";
const assert = require("assert");
const { MEMORY_ENGINE_VERSION } = require("../resources/app/out/main/version");
const { CURRENT_MEMORY_SCHEMA_VERSION } = require("../resources/app/out/main/memory-system/memory-schema");
assert.equal(MEMORY_ENGINE_VERSION, "3.0", "Part 3 upgrades retrieval version without migrating the storage schema");
assert.equal(CURRENT_MEMORY_SCHEMA_VERSION, 2);
console.log("V8.6.2 Memory Regression: PASS (3.0 retrieval version, schema 2 storage compatibility)");
