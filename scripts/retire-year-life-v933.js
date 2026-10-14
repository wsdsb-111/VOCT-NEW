"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const sourceVersionPath = require.resolve("../src/app/main/version");
require.cache[sourceVersionPath] = { exports: require("../resources/app/out/main/version") };
const { MemoryStore } = require("../src/app/main/memory-system/memory-store");
const { planYearLifeRetirement, executeYearLifeRetirement, recoverYearLifeRetirement } = require("../src/app/main/memory-system/memory4-retirement-migration");
const { assertNoLinks } = require("../src/app/main/memory-system/scoped-path");

function usage() {
  return [
    "Usage:",
    "  node scripts/retire-year-life-v933.js --summary-root <path> --owner <numeric-id> [--owner <numeric-id> ...] [--dry-run]",
    "  node scripts/retire-year-life-v933.js --summary-root <path> --memory-root <path> --owner <numeric-id> [--owner <numeric-id> ...] --apply --confirm <plan-hash>",
    "  node scripts/retire-year-life-v933.js --summary-root <path> --memory-root <path> --owner <numeric-id> [--owner <numeric-id> ...] --recover-lock",
    "",
    "Dry-run is the default. Apply requires the exact hash from a fresh dry-run."
  ].join("\n");
}

function parseArgs(argv) {
  const options = { ownerIds: [], apply: false, recoverLock: false, help: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") { options.help = true; continue; }
    if (argument === "--dry-run") { options.dryRun = true; continue; }
    if (argument === "--apply") { options.apply = true; continue; }
    if (argument === "--recover-lock") { options.recoverLock = true; continue; }
    if (["--summary-root", "--memory-root", "--owner", "--confirm"].includes(argument)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error("missing_value_for_" + argument.slice(2).replace(/-/g, "_"));
      if (argument === "--owner") {
        if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("invalid_owner_id");
        options.ownerIds.push(Number(value));
      } else if (argument === "--summary-root") options.summaryFoldersDir = value;
      else if (argument === "--memory-root") options.memoryRoot = value;
      else options.confirmPlanHash = value;
      continue;
    }
    throw new Error("unknown_argument");
  }
  if (Number(options.apply) + Number(options.recoverLock) + Number(Boolean(options.dryRun)) > 1) throw new Error("choose_one_mode");
  if (options.confirmPlanHash && !options.apply) throw new Error("confirm_requires_apply");
  if (options.apply && !/^[a-f0-9]{64}$/.test(options.confirmPlanHash || "")) throw new Error("apply_requires_plan_hash_confirmation");
  if (!options.help && (!options.summaryFoldersDir || !path.isAbsolute(options.summaryFoldersDir))) throw new Error("absolute_summary_root_required");
  if (!options.help && !options.ownerIds.length) throw new Error("owner_scope_required");
  if (options.memoryRoot && !path.isAbsolute(options.memoryRoot)) throw new Error("absolute_memory_root_required");
  if ((options.apply || options.recoverLock) && !options.memoryRoot) throw new Error("apply_requires_memory_root");
  return options;
}

function resolveRecoveryRoot(memoryRoot) {
  // Both layouts exist in the established MemoryStore contract. Do not create a second Recovery directory.
  const candidates = [path.join(memoryRoot, "recovery"), path.join(path.dirname(memoryRoot), "memory_recovery")];
  const existing = candidates.filter(directory => {
    assertNoLinks(directory, "memory4_retirement_journal_root_invalid");
    return fs.existsSync(directory) && fs.lstatSync(directory).isDirectory();
  });
  if (existing.length !== 1) throw new Error("memory4_retirement_recovery_root_ambiguous");
  return existing[0];
}

function verifyMemoryRoot(memoryRoot, summaryFoldersDir, { allowRecovery = false } = {}) {
  const root = path.resolve(memoryRoot), summaryRoot = path.resolve(summaryFoldersDir);
  assertNoLinks(root, "memory4_retirement_journal_root_invalid");
  if (!fs.existsSync(root) || !fs.lstatSync(root).isDirectory()) throw new Error("memory4_retirement_journal_root_invalid");
  const relative = path.relative(summaryRoot, root);
  if (!relative || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
    throw new Error("memory4_retirement_journal_root_invalid");
  }
  for (const name of ["episodes", "characters", "pairs", "knowledge", "owner-status", "memory4-recovery"]) {
    const directory = path.join(root, name);
    assertNoLinks(directory, "memory4_retirement_journal_root_invalid");
    if (!fs.existsSync(directory) || !fs.lstatSync(directory).isDirectory()) throw new Error("memory4_retirement_journal_root_invalid");
  }
  resolveRecoveryRoot(root);
  const indexPath = path.join(root, "index.json");
  assertNoLinks(indexPath, "memory4_retirement_journal_root_invalid");
  if (!fs.existsSync(indexPath) || !fs.lstatSync(indexPath).isFile()) throw new Error("memory4_retirement_journal_root_invalid");
  let index;
  try { index = JSON.parse(fs.readFileSync(indexPath, "utf8").replace(/^\uFEFF/, "")); }
  catch { throw new Error("memory4_retirement_journal_root_invalid"); }
  if (!index || typeof index !== "object" || Array.isArray(index) || !index.memories || !index.episodes
    || !allowRecovery && (fs.existsSync(path.join(root, "summary-mutation.json"))
      || fs.existsSync(path.join(root, "memory4-retirement-v933.lock")))) throw new Error("memory4_retirement_journal_root_invalid");
}

function runPowerShell(script, target) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8", windowsHide: true, env: { ...process.env, VOTC_MEMORY4_RETIREMENT_TARGET: target || "",
      PSModulePath: path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "Modules") }
  });
  if (result.error || result.status !== 0) {
    const error = new Error("memory4_retirement_windows_safety_check_failed");
    error.exitCode = result.status;
    error.diagnostic = String(result.stderr || "").slice(0, 1000);
    throw error;
  }
}

function assertAppClosed() {
  if (process.platform !== "win32") return;
  runPowerShell("$ErrorActionPreference='Stop'; if (Get-Process -Name 'VOTC' -ErrorAction SilentlyContinue) { exit 7 }; exit 0");
}

function verifyPrivateAcl(target) {
  if (process.platform !== "win32") return;
  const script = [
    "$ErrorActionPreference='Stop'",
    "$target=$env:VOTC_MEMORY4_RETIREMENT_TARGET",
    "if (-not (Test-Path -LiteralPath $target)) { exit 5 }",
    "$acl=Get-Acl -LiteralPath $target",
    "$current=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
    "$allowed=@($current,'S-1-5-18','S-1-5-32-544')",
    "$ownerSid=$acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value",
    "if ($allowed -notcontains $ownerSid) { exit 6 }",
    "$rules=$acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])",
    "$hasFull=$false",
    "foreach ($rule in $rules) {",
    "  $sid=$rule.IdentityReference.Value",
    "  if (($allowed -notcontains $sid) -or $rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { exit 7 }",
    "  if (($sid -eq $current -or $sid -eq 'S-1-5-32-544') -and (($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl)) { $hasFull=$true }",
    "}",
    "if (-not $hasFull) { exit 8 }",
    "exit 0"
  ].join("; ");
  runPowerShell(script, target);
}

function printCounts(counts) {
  return [
    `Owner 范围：${counts.owners} 人，Sidecar Campaign：${counts.campaigns} 个`,
    `待删除：年度文件 ${counts.yearFiles} 份，人生文件 ${counts.lifeFiles} 份，其中手工编辑 ${counts.manualFiles} 份`,
    `待清理内容：${counts.bytes} 字节；待更新旧派生元数据 ${counts.metadataFilesUpdated} 个；空 years 目录 ${counts.emptyYearDirectories} 个`
  ].join("\n");
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) { console.log(usage()); return 0; }
  if (options.recoverLock) {
    assertAppClosed();
    verifyMemoryRoot(options.memoryRoot, options.summaryFoldersDir, { allowRecovery: true });
    const memoryRoot = path.resolve(options.memoryRoot);
    verifyPrivateAcl(memoryRoot);
    const lockPath = path.join(memoryRoot, "memory4-retirement-v933.lock");
    assertNoLinks(lockPath, "memory4_retirement_lock_invalid");
    if (!fs.existsSync(lockPath)) throw new Error("memory4_retirement_lock_missing");
    verifyPrivateAcl(lockPath);
    const journalPath = path.join(memoryRoot, "summary-mutation.json");
    if (fs.existsSync(journalPath)) verifyPrivateAcl(journalPath);
    const recoveryStore = { baseDir: memoryRoot, summaryFoldersDir: path.resolve(options.summaryFoldersDir) };
    const result = recoverYearLifeRetirement({ store: recoveryStore, ownerIds: options.ownerIds, restoreJournal: () => {
      const store = Object.create(MemoryStore.prototype);
      store.baseDir = recoveryStore.baseDir;
      store.summaryFoldersDir = recoveryStore.summaryFoldersDir;
      store.summaryMutationPath = path.join(store.baseDir, "summary-mutation.json");
      store.restoreSummaryMutation();
    } });
    console.log(`恢复状态：${result.status}`);
    console.log(`计划哈希：${result.planHash}`);
    return 0;
  }
  const plan = planYearLifeRetirement({ summaryFoldersDir: options.summaryFoldersDir, ownerIds: options.ownerIds });
  console.log("Memory4 Year/Life 退役计划（V9.3.3）");
  console.log(printCounts(plan.counts));
  console.log(`计划哈希：${plan.planHash}`);
  if (!options.apply) {
    console.log("仅 dry-run；未修改任何摘要或 Memory4 数据。需要执行时，请先重新核对范围，再使用 --apply --memory-root <path> --confirm <计划哈希>。");
    return 0;
  }
  verifyMemoryRoot(options.memoryRoot, options.summaryFoldersDir);
  assertAppClosed();
  verifyPrivateAcl(path.resolve(options.memoryRoot));
  console.log("执行说明：这会删除历史 Year/Life 展示和手工文字，不会删除 Detail/Legacy 原文；若手工文字未存在于 Detail/Legacy，就无法从它们自动恢复。事务提交后临时副本会销毁，回滚旧版本也不能保证找回。正在按已确认的计划哈希执行。");
  const store = new MemoryStore({ baseDir: path.resolve(options.memoryRoot), summaryFoldersDir: path.resolve(options.summaryFoldersDir),
    recoveryDir: resolveRecoveryRoot(path.resolve(options.memoryRoot)) });
  const memoryRoot = path.resolve(options.memoryRoot);
  const result = executeYearLifeRetirement({ store, ownerIds: options.ownerIds, confirmPlanHash: options.confirmPlanHash, hooks: {
    afterLock: ({ lockPath }) => { assertAppClosed(); verifyPrivateAcl(memoryRoot); verifyPrivateAcl(lockPath); },
    afterStage: () => { assertAppClosed(); verifyPrivateAcl(memoryRoot); verifyPrivateAcl(path.join(memoryRoot, "memory4-retirement-v933.lock"));
      verifyPrivateAcl(path.join(memoryRoot, "summary-mutation.json")); },
    beforeCommit: () => { assertAppClosed(); verifyPrivateAcl(memoryRoot); verifyPrivateAcl(path.join(memoryRoot, "memory4-retirement-v933.lock"));
      verifyPrivateAcl(path.join(memoryRoot, "summary-mutation.json")); }
  } });
  console.log(`状态：${result.status}`);
  console.log(`已完成计划：${result.planHash}`);
  return 0;
}

if (require.main === module) {
  try { process.exitCode = main(); }
  catch (error) {
    console.error(`Year/Life 退役失败：${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { main, parseArgs, verifyMemoryRoot, assertAppClosed, verifyPrivateAcl };
