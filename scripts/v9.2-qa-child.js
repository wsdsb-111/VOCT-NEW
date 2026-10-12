"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { Memory4Coordinator } = require("../resources/app/out/main/memory-system/memory4-coordinator");

const requestPath = process.argv[2];
if (!requestPath) throw new Error("v92_qa_child_request_required");

const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
const store = new MemoryStore({ baseDir: request.baseDir, summaryFoldersDir: request.summaryFoldersDir });
const coordinator = new Memory4Coordinator(store);
const originalWriteJson = store.writeJson.bind(store);
const targetPath = request.target === "body"
  ? path.join(coordinator.store.directory(request.snapshot), "entries", `${request.entryId}.json`)
  : request.target === "known" || request.target === "metadata" || request.target === "index"
    ? path.join(coordinator.store.directory(request.snapshot), `${request.target === "known" ? "known-entities" : request.target}.json`)
    : null;

store.writeJson = (filePath, value) => {
  originalWriteJson(filePath, value);
  const resolved = path.resolve(filePath);
  const crashedAfterJournalPrepared = request.target === "journal"
    && resolved === path.resolve(store.summaryMutationPath)
    && value?.files && Object.keys(value.files).length > 0;
  if (crashedAfterJournalPrepared || targetPath && resolved === path.resolve(targetPath)) process.exit(73);
};

coordinator.store.commitOwner(request.snapshot, request.result);
process.exit(0);
