"use strict";
const assert = require("assert");
const { MEMORY_ENGINE_VERSION } = require("../resources/app/out/main/version");
const { CURRENT_MEMORY_SCHEMA_VERSION } = require("../resources/app/out/main/memory-system/memory-schema");
assert.equal(MEMORY_ENGINE_VERSION, "2.5", "V8.6.2 label change must not migrate the frozen Memory data contract");
assert.equal(CURRENT_MEMORY_SCHEMA_VERSION, 2);
console.log("V8.6.2 Memory Regression: PASS (2.5 data contract frozen, 2.6 UI label only)");
