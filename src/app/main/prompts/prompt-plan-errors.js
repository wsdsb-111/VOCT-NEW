"use strict";

class PromptPlanError extends Error {
  constructor(code) {
    super(code);
    this.name = "PromptPlanError";
    this.code = code;
  }
}

function requirePlan(condition, code) {
  if (!condition) throw new PromptPlanError(code);
}

module.exports = { PromptPlanError, requirePlan };
