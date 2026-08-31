"use strict";

const { getLegacyReferenceByYear } = require("../historical-system/historical-baseline");

function getHistoricalReferenceByYear(year) {
  return getLegacyReferenceByYear(year);
}

module.exports = { getHistoricalReferenceByYear };
