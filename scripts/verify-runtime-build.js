"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readPayload, verifyArtifacts, listFiles, rejectLinks, sha256 } = require("./build-runtime");

function validateDeploymentReceipt(rootDir, { allowIncompleteDeployment = false } = {}) {
  const stateDir = path.join(rootDir, ".build/runtime-deploy-state");
  const receiptPath = path.join(stateDir, "receipt.json");
  rejectLinks(stateDir);
  rejectLinks(receiptPath);
  if (!fs.existsSync(receiptPath)) return null;
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  } catch (_) {
    throw new Error("build_deploy_receipt_invalid");
  }
  if (!receipt || receipt.schemaVersion !== 1) throw new Error("build_deploy_receipt_invalid");
  if (receipt.status === "IN_PROGRESS") {
    if (!allowIncompleteDeployment) throw new Error("build_deploy_incomplete");
    return receipt;
  }
  if (!(receipt.status === "COMPLETED" || receipt.status === "RECOVERED")
    || !/^[a-f0-9]{64}$/.test(receipt.payloadSha256 || "") || !Array.isArray(receipt.files)) {
    throw new Error("build_deploy_receipt_invalid");
  }
  const names = new Set();
  for (const item of receipt.files) {
    const value = item?.path;
    if (typeof value !== "string" || !value || /[\\:\x00-\x1f]/.test(value)
      || value.split("/").some(part => !part || part === "." || part === ".." || /[. ]$/.test(part)
        || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
      || !(value === "package.json" || /^(out\/(main|preload|renderer)|default_userdata)\//.test(value))
      || !/^[a-f0-9]{64}$/.test(item.sha256 || "") || names.has(value)) {
      throw new Error("build_deploy_receipt_invalid");
    }
    names.add(value);
  }
  return receipt;
}

function verifyReceiptTarget(appDir, receipt) {
  const expected = new Set(receipt.files.map(item => item.path));
  const actual = new Set();
  const packageFile = path.join(appDir, "package.json");
  rejectLinks(packageFile);
  if (fs.existsSync(packageFile)) actual.add("package.json");
  for (const directory of ["out", "default_userdata"]) {
    const current = path.join(appDir, directory);
    rejectLinks(current);
    if (!fs.existsSync(current)) continue;
    for (const name of listFiles(current)) actual.add(`${directory}/${name}`);
  }
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error("build_deploy_receipt_target_mismatch");
  }
  for (const item of receipt.files) {
    const file = path.join(appDir, ...item.path.split("/"));
    rejectLinks(file);
    if (sha256(fs.readFileSync(file)) !== item.sha256) throw new Error(`build_deploy_receipt_target_mismatch:${item.path}`);
  }
}

function verifyRuntimeBuild({ rootDir = path.resolve(__dirname, ".."), outputDir = path.join(rootDir, ".build/runtime"), deployed = false,
  allowIncompleteDeployment = false } = {}) {
  rootDir = path.resolve(rootDir);
  const receipt = validateDeploymentReceipt(rootDir, { allowIncompleteDeployment });
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
    if (receipt && receipt.status !== "IN_PROGRESS") verifyReceiptTarget(appDir, receipt);
  }
  return manifest;
}

if (require.main === module) {
  if (process.argv.slice(2).some(arg => arg !== "--deployed")) throw new Error("build_unknown_verify_argument");
  const manifest = verifyRuntimeBuild({ deployed: process.argv.includes("--deployed") });
  console.log(`VOTC build verification: PASS (${manifest.files.length} source/artifact hashes${process.argv.includes("--deployed") ? ", deployed parity" : ""})`);
}

module.exports = { verifyRuntimeBuild, validateDeploymentReceipt, verifyReceiptTarget };
