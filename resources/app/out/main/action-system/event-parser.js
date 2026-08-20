"use strict";

function parse(text, { legacyParse } = {}) {
  if (typeof legacyParse !== "function") throw new Error("missing_event_parser_implementation");
  return legacyParse(text);
}

module.exports = { parse };
