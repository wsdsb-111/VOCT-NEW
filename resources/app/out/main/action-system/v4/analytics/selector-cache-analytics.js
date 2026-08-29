"use strict";

const crypto = require("crypto");

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}

function build({ stablePrefix, availableCatalog, context }) {
  return {
    selectorVersion: "ae4-selector-v1",
    catalogVersion: "ae4-c2-v1",
    schemaVersion: "ae4-q2-v1",
    stablePrefixHash: hash(stablePrefix),
    availableCatalogHash: hash(availableCatalog),
    p2ContextHash: hash(context)
  };
}

module.exports = { hash, build };
