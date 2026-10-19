"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const exporterPath = process.argv[2];
const source = exporterPath ? fs.readFileSync(exporterPath, "utf8")
  : "log_relatives = {\n" + fs.readFileSync(path.join(__dirname,
    "../docs/current/v9/patches/V9_3_9_KIDS_DIRECT_PARENT_EVIDENCE.patch"), "utf8")
    .split(/\r?\n/u).filter(line => line.startsWith(" ") || line.startsWith("+") && !line.startsWith("+++"))
    .map(line => line.slice(1)).join("\n");
const relativesStart = source.indexOf("log_relatives = {");
assert(relativesStart >= 0, "the active exporter must define log_relatives");
const childrenStart = source.indexOf("every_child = {", relativesStart);
assert(childrenStart >= 0, "the active exporter must log direct children");
const nextSection = source.indexOf("# kid other parent", childrenStart);
assert(nextSection > childrenStart, "the active exporter must retain the existing child-parent section");
const childrenBlock = source.slice(childrenStart, nextSection);

const validatesOwnerAsLegalParent = /any_parent\s*=\s*\{\s*even_if_dead\s*=\s*yes\s*this\s*=\s*scope:votc_mcc_tmp_var\s*OR\s*=\s*\{\s*this\s*=\s*scope:votc_v937_relative_subject\.mother\s*this\s*=\s*scope:votc_v937_relative_subject\.father\s*\}\s*\}/u.test(childrenBlock);
assert(validatesOwnerAsLegalParent,
  "PUBLIC_LEGAL_PARENT requires the current owner to be the child's actual CK3 mother or father");

const rows = [...childrenBlock.matchAll(/debug_log\s*=\s*"(VOTC:IN\/;\/kids\/;\/[^\r\n]+)"/gu)].map(match => match[1]);
assert.equal(rows.length, 2, "emit a guarded public-parent row and a fail-closed unknown row");
assert(rows.every(row => row.includes("[THIS.Char.GetAge]/;/")), "both statuses must keep the original raw GetAge field");
assert(rows.some(row => row.endsWith("PUBLIC_LEGAL_PARENT/;/")), "validated mother/father rows carry the public marker");
assert(rows.some(row => row.endsWith("UNKNOWN/;/")), "all other rows remain explicitly unknown");

process.stdout.write(`V9.3.9.3 ${exporterPath ? "active" : "repository patch"} age exporter contract: PASS (mother/father validation, raw GetAge preserved, non-parent fails closed)\n`);
