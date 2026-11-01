"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { rejectLinks, sha256 } = require("./build-runtime");
const { statePaths, validateReceipt, verifyReceiptTargets } = require("./deploy-runtime-build");
const baseline = require("./fixtures/v9.7/runtime-v961.json");

// Only the fresh, isolated CI checkout may adopt the pinned pre-upgrade payload.
// Normal/user deployment retains its existing fail-closed initial-target guard.
function seedCiRuntimeBaseline({ rootDir = path.resolve(__dirname, ".."), environment = process.env } = {}) {
  rootDir = path.resolve(rootDir);
  if (environment.GITHUB_ACTIONS !== "true" || !environment.GITHUB_WORKSPACE
    || path.resolve(environment.GITHUB_WORKSPACE) !== rootDir) throw new Error("ci_baseline_isolated_checkout_required");
  const receiptPath = statePaths(rootDir).receiptPath;
  rejectLinks(receiptPath);
  if (fs.existsSync(receiptPath)) throw new Error("ci_baseline_existing_receipt_rejected");
  const appDir = path.join(rootDir, "resources/app");
  const files = baseline.files.map(item => {
    const file = path.join(appDir, item.path);
    rejectLinks(file);
    const bytes = fs.readFileSync(file), actualHash = sha256(bytes);
    if (actualHash !== item.sha256) {
      // Match the existing deploy bootstrap's CRLF allowance for Git text files.
      // The receipt records actual bytes; neither old files nor pinned hashes change.
      const text = bytes.toString("utf8");
      if (!Buffer.from(text).equals(bytes) || sha256(Buffer.from(text.replace(/\r\n/g, "\n"))) !== item.sha256) {
        throw new Error(`build_deploy_target_mismatch:${item.path}`);
      }
    }
    return { path: item.path, sha256: actualHash };
  });
  const receipt = validateReceipt({ schemaVersion: 1, status: "COMPLETED", payloadSha256: baseline.payloadSha256, files });
  verifyReceiptTargets(appDir, receipt);
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  return { files: receipt.files.length, payloadSha256: receipt.payloadSha256 };
}

if (require.main === module) console.log("Pinned CI baseline: " + JSON.stringify(seedCiRuntimeBaseline()));
module.exports = { seedCiRuntimeBaseline };
