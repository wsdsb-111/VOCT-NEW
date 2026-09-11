"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const rendererPath = path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js");
const cssPath = path.join(root, "resources", "app", "out", "renderer", "assets", "index-WtJH_nua.css");
const rendererSource = fs.readFileSync(rendererPath, "utf8");
const cssSource = fs.readFileSync(cssPath, "utf8");

assert(rendererSource.includes("const actionLifecycleLabel"));
for (const status of ["VALIDATED", "DISPATCHED", "CONFIRMED", "UNCONFIRMED", "STATE_MISMATCH", "TIMEOUT", "DISPATCH_FAILED"]) assert(rendererSource.includes(status), `missing lifecycle UI status: ${status}`);
assert(rendererSource.includes("feedback.lifecycle?.status"));
assert(rendererSource.includes("entry.lifecycle?.status"));
assert(rendererSource.includes("action-feedback-status"));
assert(cssSource.includes(".action-feedback-status"));
assert(cssSource.includes(".action-feedback-item.pending-confirmation"));
console.log("VOTC v8.8.3 Luna Action lifecycle UI: PASS");
