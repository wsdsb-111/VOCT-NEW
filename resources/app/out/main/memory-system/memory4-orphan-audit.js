"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assertScope, hash, ids, strings } = require("./memory4-contract");
const { createProjectionLineage, projectionLineageFromSummary, matchesProjectionLineage, segmentAliases } = require("./memory4-forget");

class Memory4OrphanAudit {
  constructor(engine) {
    this.engine = engine;
  }

  audit(scope) {
    assertScope(scope);
    const coordinator = this.engine.memory4;
    const store = coordinator.store;
    const directory = store.directory(scope);
    const index = store.loadIndex(scope);
    const forgotten = store.listForgottenProjections(scope);
    const fingerprints = [];
    const read = file => {
      if (fs.lstatSync(file).isSymbolicLink()) throw new Error("memory4_symlink_path");
      const bytes = fs.readFileSync(file);
      fingerprints.push([path.resolve(file), hash(bytes.toString("base64"))]);
      return store.read(file, null);
    };
    const fingerprintTree = folder => {
      if (!fs.existsSync(folder)) return;
      if (fs.lstatSync(folder).isSymbolicLink()) throw new Error("memory4_symlink_path");
      for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(folder, entry.name);
        if (entry.isSymbolicLink()) throw new Error("memory4_symlink_path");
        if (entry.isDirectory()) fingerprintTree(file);
        else fingerprints.push([path.resolve(file), hash(fs.readFileSync(file).toString("base64"))]);
      }
    };
    fingerprintTree(directory);
    const visible = [];
    const root = this.engine.store.summaryFoldersDir;
    if (fs.lstatSync(root).isSymbolicLink()) throw new Error("memory4_symlink_path");
    for (const folder of fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.name.startsWith(`${scope.ownerId}_`))) {
      if (folder.isSymbolicLink()) throw new Error("memory4_symlink_path");
      if (!folder.isDirectory()) continue;
      for (const name of fs.readdirSync(path.join(root, folder.name)).filter(name => name.endsWith(".json")).sort()) {
        const records = read(path.join(root, folder.name, name));
        if (!Array.isArray(records)) throw new Error("memory4_orphan_visible_summary_invalid");
        for (const record of records) {
          if (!record || typeof record !== "object") throw new Error("memory4_orphan_visible_summary_invalid");
          if (record.campaignToken && record.campaignToken !== scope.campaignToken) continue;
          if (Number(record.perspectiveOwnerId ?? record.playerId ?? scope.ownerId) !== scope.ownerId) continue;
          if (record.sourceType === "CK3_OFFICIAL_RECOLLECTION") continue;
          let lineage = null;
          try { lineage = projectionLineageFromSummary(record, { ownerId: scope.ownerId }); } catch (_error) { /* Ambiguous records prevent orphan proof. */ }
          visible.push({ record, lineage });
        }
      }
    }

    const candidates = new Map();
    const add = (lineage, evidence, reason = null) => {
      let normalized = null;
      try {
        normalized = createProjectionLineage(lineage);
        if (normalized.ownerId !== scope.ownerId || normalized.campaignToken !== scope.campaignToken) normalized = null;
      } catch (_error) { /* Invalid lineage remains UNKNOWN, never a cleanup target. */ }
      const key = normalized?.projectionId || `unknown_${hash(evidence)}`;
      const item = candidates.get(key) || { ...(normalized || scope), projectionId: normalized?.projectionId || null,
        counterpartId: normalized?.counterpartId || null,
        conversationId: normalized?.conversationId || (typeof lineage?.conversationId === "string" ? lineage.conversationId : null),
        finalizationId: normalized?.finalizationId || (typeof lineage?.finalizationId === "string" ? lineage.finalizationId : null),
        sourceLetterId: normalized?.sourceLetterId || null,
        segmentIds: normalized?.segmentIds || [], sourceSegmentIds: [], sourceMessageIds: [], legacyMemoryIds: [],
        canonicalEntryIds: [], disclosureFactIds: [], recoveryFiles: [], reasons: [] };
      for (const field of ["sourceSegmentIds", "legacyMemoryIds", "canonicalEntryIds", "disclosureFactIds", "recoveryFiles"]) {
        item[field] = strings([...item[field], ...(normalized?.[field] || []), ...(evidence[field] || [])]);
      }
      item.sourceMessageIds = [...new Set([...item.sourceMessageIds, ...(normalized?.sourceMessageIds || []), ...(evidence.sourceMessageIds || [])])]
        .filter(id => Number.isSafeInteger(id) && id >= 0).sort((a, b) => a - b);
      if (reason) item.reasons = strings([...item.reasons, reason]);
      candidates.set(key, item);
    };
    const addSource = (source, counterpartIds, evidence) => {
      evidence = { ...evidence, legacyMemoryIds: strings([...(evidence.legacyMemoryIds || []),
        ...(source?.summaryIds || []), ...(source?.legacyMemoryIds || []), ...(source?.legacyRefs || []).map(ref => ref.memoryId)]) };
      if (Array.isArray(source?.projectionLineages) && source.projectionLineages.length) {
        const sharedUnproven = evidence.canonicalEntryIds?.length && source.projectionLineages.length > 1
          && (!strings(source.segmentIds).length || source.projectionLineages.some(lineage =>
            !strings(source.segmentIds).every(id => segmentAliases(lineage.sourceSegmentIds).has(id))));
        for (const lineage of source.projectionLineages) add(lineage, evidence, sharedUnproven ? "SHARED_SOURCE_COVERAGE_UNPROVEN" : null);
        return;
      }
      const counterparts = ids(counterpartIds).filter(id => id !== scope.ownerId);
      if (counterparts.length === 1 && source?.conversationId && source?.finalizationId && strings(source.segmentIds).length) {
        add({ ...scope, counterpartId: counterparts[0], conversationId: source.conversationId,
          finalizationId: source.finalizationId, sourceLetterId: source.sourceLetterId,
          segmentIds: source.segmentIds, sourceSegmentIds: source.segmentIds, sourceMessageIds: source.messageIds,
          legacyMemoryIds: evidence.legacyMemoryIds }, evidence, "EXACT_SINGLE_PAIR_SOURCE");
      } else add({ ...scope, conversationId: source?.conversationId, finalizationId: source?.finalizationId }, evidence, "SOURCE_LINEAGE_INCOMPLETE");
    };
    for (const [entryId, row] of Object.entries(index.entries)) {
      if (row.deleted) continue;
      const entry = read(store.entryPath(directory, entryId));
      if (!entry || entry.entryId !== entryId || entry.ownerId !== scope.ownerId || entry.campaignToken !== scope.campaignToken
        || hash(entry) !== row.bodyHash) throw new Error("memory4_orphan_entry_invalid");
      addSource(entry.source, entry.counterpartIds, { canonicalEntryIds: [entryId] });
    }
    const known = store.readKnownEntities(scope);
    for (const entity of Object.values(known.entities)) for (const [factId, fact] of Object.entries(entity.disclosedFacts || {})) {
      for (const proof of Object.values(fact.evidenceBySource || {})) {
        if (proof.sourceKind === "DIRECT_OBSERVATION") continue;
        addSource({ ...proof, conversationId: proof.sourceConversationId, finalizationId: proof.sourceFinalizationId,
          segmentIds: proof.sourceFragmentIds, messageIds: proof.sourceMessageIds }, [], { disclosureFactIds: [factId] });
      }
    }
    if (fs.existsSync(coordinator.recoveryDir)) {
      if (fs.lstatSync(coordinator.recoveryDir).isSymbolicLink()) throw new Error("memory4_symlink_path");
      for (const name of fs.readdirSync(coordinator.recoveryDir).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort()) {
        const file = path.join(coordinator.recoveryDir, name);
        read(file);
        const snapshot = coordinator.readRecovery(file).snapshot;
        if (snapshot.campaignToken !== scope.campaignToken || snapshot.ownerId !== scope.ownerId) continue;
        addSource({ ...snapshot, segmentIds: snapshot.fragments?.map(fragment => fragment.fragmentId),
          messageIds: snapshot.fragments?.flatMap(fragment => fragment.sourceMessageIds || []) }, snapshot.counterpartIds,
        { recoveryFiles: [name] });
      }
    }
    for (const lineage of forgotten) add(lineage, {});
    const items = [...candidates.values()].map(item => {
      let matchCount = 0, possible = false;
      for (const { record, lineage } of visible) {
        if (item.projectionId && lineage && matchesProjectionLineage(item, lineage)) { matchCount++; continue; }
        const pair = Number(record.characterId ?? record.provenance?.counterpartId);
        const validPair = Number.isSafeInteger(pair) && pair > 0 && pair !== scope.ownerId;
        if (!validPair || !lineage && (record.projectionId || record.provenance?.projectionId) === item.projectionId) {
          possible = true;
          continue;
        }
        if (pair !== item.counterpartId) continue;
        // Missing campaign or source identity is not evidence that a visible projection is absent.
        if (!record.campaignToken || !lineage || item.conversationId && lineage.conversationId === item.conversationId
          || item.finalizationId && lineage.finalizationId === item.finalizationId) possible = true;
      }
      const isForgotten = item.projectionId && forgotten.some(target => matchesProjectionLineage(target, item));
      const inProgress = this.engine.activeFinalizationIds.has(item.finalizationId)
        || item.recoveryFiles.some(name => coordinator.inFlight.has(path.join(coordinator.recoveryDir, name)));
      const status = !item.projectionId ? "UNKNOWN" : isForgotten ? "FORGOTTEN" : matchCount ? "ACTIVE"
        : inProgress ? "UNKNOWN"
        : item.reasons.includes("SHARED_SOURCE_COVERAGE_UNPROVEN") ? "UNKNOWN"
        : possible ? "UNKNOWN" : "ORPHANED_PRE_V815_PROJECTION";
      return { ...item, visibleSummaryMatchCount: matchCount, status,
        reasons: strings([...item.reasons, ...(possible && !matchCount ? ["VISIBLE_SOURCE_MAPPING_UNCERTAIN"] : []),
          ...(inProgress ? ["FINALIZATION_IN_PROGRESS"] : [])]) };
    }).sort((a, b) => String(a.projectionId || a.canonicalEntryIds.join()).localeCompare(String(b.projectionId || b.canonicalEntryIds.join())));
    for (const item of items) {
      if (item.status !== "ORPHANED_PRE_V815_PROJECTION") continue;
      if (items.some(other => !other.projectionId && (item.conversationId && other.conversationId === item.conversationId
        || item.finalizationId && other.finalizationId === item.finalizationId))) {
        item.status = "UNKNOWN";
        item.reasons = strings([...item.reasons, "RELATED_SOURCE_MAPPING_UNCERTAIN"]);
      } else if (items.some(other => other.status === "ACTIVE" && other.projectionId !== item.projectionId
        && other.legacyMemoryIds.some(id => item.legacyMemoryIds.includes(id)))
        || visible.some(({ record, lineage }) => strings([...(record.perspectiveMemoryIds || []),
          ...(record.legacyMemoryIds || []), ...(record.provenance?.perspectiveMemoryIds || []),
          ...(record.provenance?.legacyMemoryIds || []), ...(lineage?.legacyMemoryIds || [])])
          .some(id => item.legacyMemoryIds.includes(id)))) {
        item.status = "UNKNOWN";
        item.reasons = strings([...item.reasons, "SHARED_LEGACY_SOURCE_UNPARTITIONED"]);
      }
    }
    const auditToken = hash([scope, fingerprints.sort((a, b) => a[0].localeCompare(b[0])), items]);
    return { ...scope, auditToken, items };
  }

  forget(scope, { projectionId, expectedAuditToken, confirmed = false } = {}) {
    if (confirmed !== true) throw new Error("memory4_orphan_confirmation_required");
    const audit = this.audit(scope);
    if (typeof expectedAuditToken !== "string" || audit.auditToken !== expectedAuditToken) throw new Error("memory4_orphan_audit_stale");
    const item = audit.items.find(row => row.projectionId === projectionId);
    if (item?.status !== "ORPHANED_PRE_V815_PROJECTION") throw new Error("memory4_orphan_not_confirmed");
    return this.engine.store.withSummaryMutation(null, () => this.engine.forgetSummaryProjection({
      ...scope, perspectiveOwnerId: scope.ownerId, characterId: item.counterpartId, projectionId: item.projectionId,
      conversationId: item.conversationId, finalizationId: item.finalizationId,
      perspectiveSummarySegmentIds: item.segmentIds, perspectiveMemoryIds: item.legacyMemoryIds,
      sourceSegmentIds: item.sourceSegmentIds, sourceMessageIds: item.sourceMessageIds, sourceLetterId: item.sourceLetterId
    }, { ownerId: scope.ownerId, counterpartId: item.counterpartId, reason: "USER_FORGET_ORPHAN" }));
  }
}

module.exports = { Memory4OrphanAudit };
