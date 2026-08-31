"use strict";

const { periods } = require("./historical-data/periods");
const { figures } = require("./historical-data/figures");
const { facts } = require("./historical-data/facts");
const { events } = require("./historical-data/events");
const { rulers } = require("./historical-data/rulers");
const { HISTORICAL_SCHEMA_VERSION, validateHistoricalDataset } = require("./schema");
const { periodToLegacyReference } = require("./compatibility-adapter");

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

const dataset = { periods, figures, facts, events, rulers };
const indexes = validateHistoricalDataset(dataset);
deepFreeze(dataset);

function getPeriodByYear(year) {
  const numericYear = Number(year);
  return periods.find((period) => {
    const afterStart = period.startYear === null || numericYear >= period.startYear;
    const beforeEnd = period.endYearExclusive === null || numericYear < period.endYearExclusive;
    return afterStart && beforeEnd;
  }) || periods[0];
}

function getLegacyReferenceByYear(year) {
  return periodToLegacyReference(getPeriodByYear(year), indexes);
}

function getBaselineSnapshot(year) {
  const period = getPeriodByYear(year);
  return {
    schemaVersion: HISTORICAL_SCHEMA_VERSION,
    requestedYear: Number.isFinite(Number(year)) ? Number(year) : null,
    period: {
      ...period,
      notableEventKeys: [...period.notableEventKeys],
      notableFigureKeys: [...period.notableFigureKeys]
    },
    legacyReference: getLegacyReferenceByYear(year)
  };
}

module.exports = {
  HISTORICAL_SCHEMA_VERSION,
  dataset,
  getPeriodByYear,
  getLegacyReferenceByYear,
  getBaselineSnapshot
};
