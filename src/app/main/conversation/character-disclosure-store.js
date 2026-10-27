"use strict";

// Pair disclosure persistence only. Automatic facts come from verified spoken
// messages, never a Worldline roster, realm membership or a model extraction.
const nodeFs = require("node:fs");
const nodePath = require("node:path");
const crypto = require("node:crypto");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");
const { normalizeTraitKey, resolveTraitVisibility } = require("../prompts/trait-visibility-policy");
const { getAutomaticTraitAccess, isPublicCloseFamily } = require("../prompts/trait-profile-selector");
const { sourceParagraphSegments, validateSourceItem } = require("../memory-system/finalization-visibility");
const { extractCharacterDisclosures, getDisclosureFactCandidates } = require("./character-disclosure-extraction");

const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const id = value => {
  const text = String(value ?? "");
  if (!/^[1-9]\d{0,19}$/.test(text)) throw new Error("character_knowledge_id_invalid");
  return text;
};
const identity = fact => JSON.stringify([fact.campaignToken, String(fact.ownerRuntimeId), String(fact.targetRuntimeId), fact.factType, fact.factKey]);
const name = character => {
  const value = String(character?.shortName || character?.firstName || character?.name || character?.fullName || "").trim();
  return value && !/^\d+$/.test(value) ? value : "姓名未载入";
};
const characterAt = (data, key) => data?.characters instanceof Map
  ? data.characters.get(Number(key)) || data.characters.get(String(key)) : data?.characters?.[key];
const SECRET_TRAITS = { secret_bastard: "bastard", secret_disputed_heritage: "disputed_heritage", secret_witch: "witch",
  secret_cannibal: "cannibal", secret_deviant: "deviant", secret_incest: "incestuous", secret_adulterer: "adulterer" };

class ConversationDisclosureStore {
  constructor({ dataDir, getCurrentConversation, fs = nodeFs, path = nodePath } = {}) {
    this.fs = fs;
    this.path = path;
    this.getCurrentConversation = getCurrentConversation;
    // V9.3.9 checkpoint-derived records are preserved; they are not dialogue proof.
    this.filePath = path.join(dataDir, "character-knowledge", "disclosures-v1.json");
  }

  _frame(expected = {}) {
    const conversation = this.getCurrentConversation?.();
    const data = conversation?.gameData;
    if (!conversation?.isActive || !data || !conversation.id) throw new Error("character_knowledge_conversation_unavailable");
    if (typeof data.campaignToken !== "string" || !data.campaignToken.trim() || !normalizeGameDate(data.date)) {
      throw new Error("character_knowledge_campaign_unavailable");
    }
    const participantIds = [...new Set([data.playerID, ...(conversation.selectedCharacterIds || [])].map(id))]
      .filter(key => !!characterAt(data, key) && !conversation.departedCharacterIds?.has(Number(key))
        && conversation.inactiveParticipantIds?.get(Number(key)) !== "dead");
    const activeParticipantIds = participantIds.map(Number).filter(key => key === Number(data.playerID)
      || conversation.presentCharacterIds?.has(key) && !conversation.temporarilyAbsentCharacterIds?.has(key)
        && !conversation.inactiveParticipantIds?.has(key));
    const scope = { conversationId: conversation.id, campaignToken: data.campaignToken,
      sourceSnapshotId: hash([conversation.id, conversation.conversationEpoch, data.campaignToken, data.date, data.totalDays, participantIds, activeParticipantIds]) };
    if (expected.conversationId !== undefined && expected.conversationId !== scope.conversationId) throw new Error("character_knowledge_conversation_changed");
    if (expected.campaignToken !== undefined && expected.campaignToken !== scope.campaignToken) throw new Error("character_knowledge_campaign_changed");
    if (expected.sourceSnapshotId !== undefined && expected.sourceSnapshotId !== scope.sourceSnapshotId) throw new Error("character_knowledge_source_changed");
    return { conversation, data, participantIds, activeParticipantIds, scope };
  }

  _pair(frame, ownerRuntimeId, targetRuntimeId, allowMentioned = false) {
    const ownerId = id(ownerRuntimeId);
    const targetId = id(targetRuntimeId);
    if (ownerId === targetId || !frame.participantIds.includes(ownerId)
      || (!allowMentioned && !frame.participantIds.includes(targetId)) || !characterAt(frame.data, targetId)) {
      throw new Error("character_knowledge_pair_unavailable");
    }
    return { ownerId, targetId };
  }

  _read() {
    if (!this.fs.existsSync(this.filePath)) return { schemaVersion: 1, records: [], sourceRevisions: {} };
    let state;
    try { state = JSON.parse(this.fs.readFileSync(this.filePath, "utf8")); } catch (_error) { throw new Error("character_knowledge_state_invalid"); }
    if (state?.schemaVersion !== 1 || !Array.isArray(state.records)) throw new Error("character_knowledge_state_invalid");
    if (!state.sourceRevisions || typeof state.sourceRevisions !== "object" || Array.isArray(state.sourceRevisions)
      || Object.values(state.sourceRevisions).some(value => !/^[a-f0-9]{64}$/.test(value))) throw new Error("character_knowledge_state_invalid");
    for (const sourceKey of Object.keys(state.sourceRevisions)) {
      let source;
      try { source = JSON.parse(sourceKey); } catch (_error) { throw new Error("character_knowledge_state_invalid"); }
      if (!Array.isArray(source) || source.length !== 2 || typeof source[0] !== "string"
        || !Number.isSafeInteger(source[1]) || source[1] < 0) throw new Error("character_knowledge_state_invalid");
    }
    const keys = new Set();
    for (const record of state.records) {
      if (!record || typeof record !== "object") throw new Error("character_knowledge_state_invalid");
      const key = identity(record);
      if (!record.campaignToken || !["NAME", "NICKNAME", "TITLE", "TRAIT"].includes(record.factType) || !record.factKey
        || typeof record.value !== "string" || !Array.isArray(record.evidence) || !Number.isSafeInteger(record.revision)
        || record.revision < 1 || keys.has(key) || !/^[1-9]\d{0,19}$/.test(record.ownerRuntimeId)
        || !/^[1-9]\d{0,19}$/.test(record.targetRuntimeId)
        || record.manual && !["MANUAL_KNOWN", "MANUAL_HIDDEN"].includes(record.manual.status)) throw new Error("character_knowledge_state_invalid");
      keys.add(key);
    }
    return state;
  }

  _write(state) {
    this.fs.mkdirSync(this.path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    try {
      this.fs.writeFileSync(temporary, JSON.stringify(state, null, 2), "utf8");
      for (let attempt = 0; ; attempt++) {
        try { this.fs.renameSync(temporary, this.filePath); break; }
        catch (error) {
          if (attempt >= 4 || !["EPERM", "EACCES", "EBUSY"].includes(error.code)) throw error;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (attempt + 1));
        }
      }
    } finally {
      if (this.fs.existsSync(temporary)) this.fs.unlinkSync(temporary);
    }
  }

  _evidenceCurrent(frame, evidence, ownerId, targetId, candidate, state, visited) {
    const acquired = normalizeGameDate(evidence?.gameDate);
    const current = normalizeGameDate(frame.data.date);
    if (!evidence || evidence.campaignToken !== frame.scope.campaignToken
      || !acquired || !current || acquired.serial > current.serial
      || !Array.isArray(evidence.audienceIds) || !evidence.audienceIds.map(String).includes(ownerId)
      || evidence.factSourceSnapshotId !== candidate.factSourceSnapshotId || !/^[a-f0-9]{64}$/.test(evidence.messageRevision || "")
      || state.sourceRevisions[JSON.stringify([evidence.conversationId, evidence.messageId])] !== evidence.messageRevision) return false;
    // A relayed assertion needs the speaker's still-valid knowledge of this
    // exact fact. Follow recorded pair proofs only; cycles grant no authority.
    if (String(evidence.speakerId) !== targetId) {
      if (!/^[1-9]\d{0,19}$/.test(String(evidence.speakerId))) return false;
      const authority = this._facts(frame, String(evidence.speakerId), targetId, state, visited)
        .find(fact => fact.factType === candidate.factType && fact.factKey === candidate.factKey
          && fact.factSourceSnapshotId === candidate.factSourceSnapshotId && fact.effectiveKnown);
      if (!authority) return false;
    }
    if (evidence.conversationId !== frame.conversation.id) return true;
    const message = frame.conversation.messages?.find(item => item.id === evidence.messageId);
    return !!message && !message.isStreaming && !message.error && hash(message.content) === evidence.messageRevision;
  }

  _facts(frame, ownerId, targetId, state, visited = new Set()) {
    const target = characterAt(frame.data, targetId);
    const owner = characterAt(frame.data, ownerId);
    const nativeKnown = new Set((owner?.knownSecrets || []).filter(secret => String(secret.ownerId) === targetId)
      .map(secret => SECRET_TRAITS[secret.type]).filter(Boolean));
    const automatic = getAutomaticTraitAccess(owner, target, frame.data, { activeParticipantIds: frame.activeParticipantIds });
    const closeFamily = isPublicCloseFamily(Number(ownerId), Number(targetId), frame.data);
    return getDisclosureFactCandidates(target).flatMap(candidate => {
      const record = state.records.find(item => identity(item) === identity({ ...candidate, campaignToken: frame.scope.campaignToken,
        ownerRuntimeId: ownerId, targetRuntimeId: targetId }));
      const factSourceSnapshotId = `fact:${hash([frame.scope.campaignToken, targetId, candidate.factType, candidate.factKey, candidate.value, candidate.aliases])}`;
      const manualDate = normalizeGameDate(record?.manual?.acquiredDate);
      const manual = record?.manual?.factSourceSnapshotId === factSourceSnapshotId && manualDate
        && manualDate.serial <= normalizeGameDate(frame.data.date).serial ? record.manual : null;
      const proofKey = identity({ ...candidate, campaignToken: frame.scope.campaignToken, ownerRuntimeId: ownerId, targetRuntimeId: targetId });
      const nextVisited = new Set(visited).add(proofKey);
      const evidence = visited.has(proofKey) ? [] : (record?.evidence || []).filter(item =>
        this._evidenceCurrent(frame, item, ownerId, targetId, { ...candidate, factSourceSnapshotId }, state, nextVisited));
      const native = candidate.factType === "TRAIT" && nativeKnown.has(normalizeTraitKey(candidate.canonicalKey || candidate.factKey.slice(6)));
      const publicNickname = candidate.factType === "NICKNAME";
      const familyFact = closeFamily && ["NAME", "TITLE", "TRAIT"].includes(candidate.factType);
      const intrinsic = manual?.status !== "MANUAL_HIDDEN"
        && (publicNickname || familyFact || candidate.factType === "TRAIT" && automatic.traitKeys.includes(candidate.factKey));
      const status = intrinsic ? "AUTO_DISCLOSED" : manual?.status || (evidence.length || native ? "AUTO_DISCLOSED" : "UNKNOWN");
      const observable = candidate.factType === "TRAIT" && resolveTraitVisibility(candidate.canonicalKey || candidate.factKey.slice(6)).status === "OBSERVABLE";
      // The player can explicitly disclose their own traits. Other people's
      // undisclosed private traits are not exposed as a catalogue to manage.
      if (candidate.factType === "TRAIT" && !observable && targetId !== String(frame.data.playerID)
        && !intrinsic && !native && !evidence.length && !manual) return [];
      return [{ ...candidate, status, effectiveKnown: status === "AUTO_DISCLOSED" || status === "MANUAL_KNOWN",
        current: true, currentDirectObservation: intrinsic, hasDisclosureRecord: evidence.length > 0,
        source: intrinsic ? publicNickname ? evidence.length ? "CONVERSATION_DISCLOSURE" : "PUBLIC_NICKNAME"
          : familyFact ? "PUBLIC_CLOSE_FAMILY" : automatic.source === "OBSERVABLE" ? "IN_PERSON_OBSERVATION" : automatic.source
          : manual ? "MANUAL" : native ? "GAME_DATA_KNOWN_SECRET" : evidence.length ? "CONVERSATION_DISCLOSURE" : "UNDISCLOSED",
        sourceSnapshotId: frame.scope.sourceSnapshotId, factSourceSnapshotId,
        firstAcquiredDate: intrinsic ? evidence[0]?.gameDate || frame.data.date : manual?.acquiredDate || evidence[0]?.gameDate || (native ? frame.data.date : null),
        revision: record?.revision || 0, sourceStatus: record && !intrinsic && !manual && !evidence.length && !native ? "STALE" : "CURRENT" }];
    });
  }

  getConversationView() {
    try {
      const frame = this._frame();
      return { available: true, scope: frame.scope, participants: frame.participantIds.map(runtimeId => ({ runtimeId,
        displayName: name(characterAt(frame.data, runtimeId)), isPlayer: runtimeId === String(frame.data.playerID) })) };
    } catch (error) { return { available: false, participants: [], reason: error.message }; }
  }

  getOwnerView(payload = {}) {
    const frame = this._frame(payload);
    const ownerId = id(payload.ownerRuntimeId);
    if (!frame.participantIds.includes(ownerId)) throw new Error("character_knowledge_pair_unavailable");
    return { available: true, scope: { ...frame.scope, ownerRuntimeId: ownerId },
      owner: { runtimeId: ownerId, displayName: name(characterAt(frame.data, ownerId)) },
      targets: frame.participantIds.filter(key => key !== ownerId).map(runtimeId => ({ runtimeId, displayName: name(characterAt(frame.data, runtimeId)) })) };
  }

  getTargetView(payload = {}) {
    const frame = this._frame(payload);
    const { ownerId, targetId } = this._pair(frame, payload.ownerRuntimeId, payload.targetRuntimeId);
    return { available: true, scope: { ...frame.scope, ownerRuntimeId: ownerId, targetRuntimeId: targetId },
      owner: { runtimeId: ownerId, displayName: name(characterAt(frame.data, ownerId)) },
      target: { runtimeId: targetId, displayName: name(characterAt(frame.data, targetId)) },
      checkpointAsOf: frame.data.date, facts: this._facts(frame, ownerId, targetId, this._read()) };
  }

  getDisclosureProfile(payload = {}) {
    try {
      const frame = this._frame(payload);
      const { ownerId, targetId } = this._pair(frame, payload.ownerRuntimeId, payload.targetRuntimeId, true);
      const facts = this._facts(frame, ownerId, targetId, this._read()).filter(fact => fact.effectiveKnown || fact.status === "MANUAL_HIDDEN");
      return { status: "READY", scope: { ...frame.scope, ownerRuntimeId: ownerId, targetRuntimeId: targetId },
        checkpointAsOf: frame.data.date, facts };
    } catch (error) { return { status: "BLOCKED", facts: [], reason: error.message }; }
  }

  setManualStatus(payload = {}) {
    if (payload.factType !== "TRAIT" || !["MANUAL_KNOWN", "MANUAL_HIDDEN"].includes(payload.status)
      || !Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0) throw new Error("character_knowledge_manual_status_invalid");
    const frame = this._frame(payload);
    if (payload.conversationId !== frame.scope.conversationId || payload.campaignToken !== frame.scope.campaignToken
      || payload.sourceSnapshotId !== frame.scope.sourceSnapshotId) throw new Error("character_knowledge_source_changed");
    const { ownerId, targetId } = this._pair(frame, payload.ownerRuntimeId, payload.targetRuntimeId);
    const state = this._read();
    const candidate = this._facts(frame, ownerId, targetId, state).find(fact => fact.factType === payload.factType && fact.factKey === payload.factKey);
    if (!candidate || candidate.factSourceSnapshotId !== payload.factSourceSnapshotId) throw new Error("character_knowledge_source_changed");
    if (candidate.currentDirectObservation) throw new Error("character_knowledge_automatic_access");
    if (candidate.revision !== payload.expectedRevision) throw new Error("character_knowledge_revision_conflict");
    const key = identity({ ...candidate, campaignToken: frame.scope.campaignToken, ownerRuntimeId: ownerId, targetRuntimeId: targetId });
    let record = state.records.find(item => identity(item) === key);
    if (!record) {
      record = { campaignToken: frame.scope.campaignToken, ownerRuntimeId: ownerId, targetRuntimeId: targetId,
        factType: candidate.factType, factKey: candidate.factKey, value: candidate.value, evidence: [], revision: 0 };
      state.records.push(record);
    }
    record.manual = { status: payload.status, factSourceSnapshotId: candidate.factSourceSnapshotId, acquiredDate: frame.data.date };
    record.revision++;
    this._write(state);
    return this.getTargetView(payload);
  }

  recordConversation({ conversation, context } = {}) {
    if (!conversation?.gameData || !context?.campaignToken || context.campaignToken !== conversation.gameData.campaignToken) return { recorded: 0 };
    const state = this._read();
    const frame = this._frame({ conversationId: context.conversationId, campaignToken: context.campaignToken });
    if (conversation !== frame.conversation) throw new Error("character_knowledge_conversation_changed");
    let recorded = 0;
    let sourcesChanged = false;
    const participantIds = (context.participants || []).map(person => Number(person.id));
    const currentMessages = new Set((context.messages || []).map(message => JSON.stringify([context.conversationId, message.id])));
    for (const sourceKey of Object.keys(state.sourceRevisions)) {
      if (JSON.parse(sourceKey)[0] === context.conversationId && !currentMessages.has(sourceKey)) {
        const removed = hash(["removed", sourceKey]);
        if (state.sourceRevisions[sourceKey] !== removed) { state.sourceRevisions[sourceKey] = removed; sourcesChanged = true; }
      }
    }
    for (const message of context.messages || []) {
      if (!["user", "assistant"].includes(message.role) || message.isStreaming || message.error) continue;
      const sourceKey = JSON.stringify([context.conversationId, message.id]);
      const messageRevision = hash(message.content);
      if (state.sourceRevisions[sourceKey] !== messageRevision) {
        state.sourceRevisions[sourceKey] = messageRevision;
        sourcesChanged = true;
      }
      for (const paragraph of sourceParagraphSegments(context, message) || []) {
        const proof = validateSourceItem(paragraph, context);
        if (!proof.success || proof.source !== "spoken") continue;
        const speakerId = proof.speakers[0];
        const source = { conversationId: context.conversationId, messageId: message.id,
          messageRevision, gameDate: context.date, campaignToken: context.campaignToken, audienceIds: proof.audience };
        const knownFacts = participantIds.filter(targetId => targetId !== speakerId).flatMap(targetId =>
          this._facts(frame, String(speakerId), String(targetId), state).filter(fact => fact.effectiveKnown)
            .map(fact => ({ ...fact, ownerRuntimeId: String(speakerId), targetRuntimeId: String(targetId) })));
        const result = extractCharacterDisclosures({ gameData: conversation.gameData, speakerId, text: paragraph.content,
          audienceIds: proof.audience, candidateTargetIds: participantIds, knownFacts, source });
        for (const fact of result.disclosures || []) {
          const key = identity({ ...fact, campaignToken: context.campaignToken });
          let record = state.records.find(item => identity(item) === key);
          if (!record) {
            record = { campaignToken: context.campaignToken, ownerRuntimeId: String(fact.ownerRuntimeId), targetRuntimeId: String(fact.targetRuntimeId),
              factType: fact.factType, factKey: fact.factKey, value: fact.value, evidence: [], revision: 0 };
            state.records.push(record);
          }
          const candidate = getDisclosureFactCandidates(characterAt(frame.data, fact.targetRuntimeId))
            .find(item => item.factType === fact.factType && item.factKey === fact.factKey);
          if (!candidate) continue;
          const factSourceSnapshotId = `fact:${hash([frame.scope.campaignToken, String(fact.targetRuntimeId), candidate.factType, candidate.factKey, candidate.value, candidate.aliases])}`;
          if (record.evidence.some(item => item.conversationId === source.conversationId && item.messageId === source.messageId
            && item.messageRevision === source.messageRevision && item.factSourceSnapshotId === factSourceSnapshotId)) continue;
          record.evidence.push({ ...source, speakerId, factSourceSnapshotId });
          record.revision++;
          recorded++;
        }
      }
    }
    if (recorded || sourcesChanged) this._write(state);
    return { recorded };
  }
}

module.exports = { ConversationDisclosureStore };
