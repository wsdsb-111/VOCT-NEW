"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "resources", "app", "out", "main", "main.js"), "utf8");
assert.match(source, /const votcHasSingleInstanceLock = electron\.app\.requestSingleInstanceLock\(\);/);
assert.match(source, /if \(!votcHasSingleInstanceLock\) electron\.app\.quit\(\);/);
assert.match(source, /electron\.app\.on\("ready", async \(\) => \{\s*if \(!votcHasSingleInstanceLock\) return;/);
assert.match(source, /electron\.app\.on\("second-instance"/);
console.log("V8.7.1 single-instance storage safety PASS");
