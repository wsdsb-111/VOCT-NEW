"use strict";

const ACTION_ENGINE_VERSION = 4;
const LEGACY_ACTION_ENGINE_VERSION = 3;

function normalizeActionEngineVersion(value) {
  return Number(value) === LEGACY_ACTION_ENGINE_VERSION ? LEGACY_ACTION_ENGINE_VERSION : ACTION_ENGINE_VERSION;
}

function configuredActionEngineVersion(explicitVersion = null) {
  return normalizeActionEngineVersion(explicitVersion ?? process.env.VOTC_ACTION_ENGINE_VERSION);
}

module.exports = {
  ACTION_ENGINE_VERSION,
  LEGACY_ACTION_ENGINE_VERSION,
  normalizeActionEngineVersion,
  configuredActionEngineVersion
};
