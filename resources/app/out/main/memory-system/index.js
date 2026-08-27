"use strict";

const memoryTypes = require("./memory-types");
const { MemoryStore } = require("./memory-store");
const { MemoryExtractor } = require("./memory-extractor");
const { MemoryRanker } = require("./memory-ranker");
const { KnowledgeService } = require("./knowledge-service");
const { RollingSummaryManager } = require("./rolling-summary-manager");
const { MemoryConsolidator } = require("./memory-consolidator");
const { MemoryTrace } = require("./memory-trace");
const { MemoryEngine } = require("./memory-engine");
const { MentionTracker } = require("./mention-tracker");
const { FinalizationCoordinator } = require("./finalization-coordinator");
const { verifyDirectedSummaryPersistence } = require("./summary-folder-verifier");
const summaryCatalog = require("./summary-catalog");
const characterIdentity = require("./character-identity");
const memorySchema = require("./memory-schema");
const perspectiveProjector = require("./perspective-projector");
const turnRecall = require("./turn-recall");

module.exports = {
  ...memoryTypes,
  ...memorySchema,
  MemoryStore,
  MemoryExtractor,
  MemoryRanker,
  KnowledgeService,
  RollingSummaryManager,
  MemoryConsolidator,
  MemoryTrace,
  MemoryEngine,
  MentionTracker,
  FinalizationCoordinator,
  verifyDirectedSummaryPersistence,
  ...perspectiveProjector,
  ...characterIdentity,
  ...summaryCatalog,
  turnRecall
};
