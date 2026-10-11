"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readPayload, verifyArtifacts, listFiles, rejectLinks, sha256 } = require("./build-runtime");

function verifyRuntimeBuild({ rootDir = path.resolve(__dirname, ".."), outputDir = path.join(rootDir, ".build/runtime"), deployed = false } = {}) {
  const payload = readPayload(rootDir);
  const expected = payload.map(item => ({ path: item.target, bytes: item.bytes.length, sha256: item.sha256 }));
  const manifest = verifyArtifacts(outputDir, expected);
  if (deployed) {
    const appDir = path.join(rootDir, "resources/app");
    for (const item of payload) {
      const file = path.join(appDir, item.target);
      rejectLinks(file);
      if (sha256(fs.readFileSync(file)) !== item.sha256) throw new Error(`build_deployed_mismatch:${item.target}`);
    }
    for (const directory of ["out", "default_userdata"]) {
      const expectedNames = payload.filter(item => item.target.startsWith(directory + "/")).map(item => item.target.slice(directory.length + 1)).sort();
      if (JSON.stringify(listFiles(path.join(appDir, directory))) !== JSON.stringify(expectedNames)) throw new Error("build_deployed_inventory_mismatch");
    }
  }
  return manifest;
}

if (require.main === module) {
  if (process.argv.slice(2).some(arg => arg !== "--deployed")) throw new Error("build_unknown_verify_argument");
  const manifest = verifyRuntimeBuild({ deployed: process.argv.includes("--deployed") });
  console.log(`VOTC build verification: PASS (${manifest.files.length} source/artifact hashes${process.argv.includes("--deployed") ? ", deployed parity" : ""})`);
}

module.exports = { verifyRuntimeBuild };
