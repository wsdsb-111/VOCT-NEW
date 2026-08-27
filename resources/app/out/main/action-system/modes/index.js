"use strict";

const modePolicy = require("./action-mode-policy");
const balanced = require("./balanced-policy");
const performance = require("./performance-policy");
const precision = require("./precision-policy");

const policies = Object.freeze({ balanced, performance, precision });

function getPolicy(mode) {
  return policies[modePolicy.normalizeActionSystemMode(mode)];
}

module.exports = { ...modePolicy, policies, getPolicy };
