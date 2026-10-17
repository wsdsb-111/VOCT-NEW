"use strict";

const { nonnegativeNumber, compareCharacterSeniority } = require("../worldline/character-age-service");

function createRelationshipResolver({ onDiagnostic = null } = {}) {
  const emit = (code, details) => {
    const diagnostic = { code, ...details, recordedAt: Date.now() };
    const accepted = typeof onDiagnostic === "function" ? onDiagnostic(diagnostic) : true;
    if (accepted !== false) console.log(`[Relationship] ${code} ${JSON.stringify(details)}`);
    return diagnostic;
  };
  const finiteDay = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  };
  const normalizeGender = (value, pronoun, inferGenderFromPronoun) => {
    if (value === "male" || value === "female") return value;
    return pronoun ? inferGenderFromPronoun(pronoun) : "unknown";
  };
  const createEvidenceRecord = (id) => ({
    id,
    canonicalCharacter: null,
    names: [],
    gender: [],
    age: [],
    birthDate: [],
    birthDateText: [],
    alive: [],
    deathDate: [],
    deathDateText: [],
    deathReason: [],
    relations: [],
    otherParentRelations: []
  });
  const pushUnique = (items, value, key) => {
    if (!items.some((item) => key(item) === key(value))) items.push(value);
  };
  const resolveTieredGender = (record) => {
    const canonicalValues = new Set(record.gender.filter((item) => item.priority === 1 && item.value !== "unknown").map((item) => item.value));
    const edgeValues = new Set(record.gender.filter((item) => item.priority > 1 && item.value !== "unknown").map((item) => item.value));
    const allValues = new Set([...canonicalValues, ...edgeValues]);
    if (canonicalValues.size > 1) {
      emit("RELATION_CONFLICT_GENDER", { characterId: record.id, values: [...allValues], evidenceCount: record.gender.length });
      return { value: "unknown", source: "conflict", conflict: true };
    }
    if (canonicalValues.size === 1) {
      const value = [...canonicalValues][0];
      const disagreement = [...edgeValues].some((item) => item !== value);
      if (disagreement) emit("RELATION_CONFLICT_GENDER", { characterId: record.id, values: [...allValues], evidenceCount: record.gender.length, selectedSource: "canonical_runtime" });
      const sourceItem = record.gender.find((item) => item.priority === 1 && item.value === value);
      return { value, source: sourceItem?.source || "characters", conflict: false, disagreement };
    }
    if (edgeValues.size > 1) {
      emit("RELATION_CONFLICT_GENDER", { characterId: record.id, values: [...allValues], evidenceCount: record.gender.length });
      return { value: "unknown", source: "conflict", conflict: true };
    }
    const selectedValues = edgeValues;
    const value = [...selectedValues][0] || "unknown";
    const sourceItem = record.gender.find((item) => item.value === value);
    return { value, source: sourceItem?.source || "unknown", conflict: false };
  };
  const resolveTieredBirthDate = (record) => {
    const canonicalValues = new Set(record.birthDate.filter((item) => item.priority === 1).map((item) => item.value));
    const edgeValues = new Set(record.birthDate.filter((item) => item.priority > 1).map((item) => item.value));
    const selectedValues = canonicalValues.size > 0 ? canonicalValues : edgeValues;
    if (selectedValues.size > 1) {
      emit("RELATION_CONFLICT_BIRTHDATE", { characterId: record.id, values: [...selectedValues], evidenceCount: record.birthDate.length });
      return { value: null, source: "conflict", conflict: true };
    }
    const value = [...selectedValues][0] ?? null;
    const sourceItem = record.birthDate.find((item) => item.value === value);
    return { value, source: sourceItem?.source || "unknown", conflict: false };
  };
  const resolveTieredAge = (record) => {
    const canonicalValues = new Set(record.age.filter((item) => item.priority === 1).map((item) => item.value));
    const edgeValues = new Set(record.age.filter((item) => item.priority > 1).map((item) => item.value));
    if (canonicalValues.size > 1) return { value: null, source: "AGE_SOURCE_CONFLICT", conflict: true };
    if (canonicalValues.size === 1) {
      const value = [...canonicalValues][0];
      const sourceItem = record.age.find((item) => item.priority === 1 && item.value === value);
      return { value, source: sourceItem?.ageSource || "CK3_CURRENT_AGE", conflict: [...edgeValues].some((item) => item !== value) };
    }
    if (edgeValues.size > 1) return { value: null, source: "AGE_SOURCE_CONFLICT", conflict: true };
    const value = [...edgeValues][0] ?? null;
    const sourceItem = record.age.find((item) => item.value === value);
    return { value, source: sourceItem?.ageSource || "UNKNOWN", conflict: false };
  };
  const resolveTieredValue = (record, field, diagnosticCode) => {
    const items = record[field].filter((item) => item.value !== null && item.value !== void 0 && item.value !== "");
    const canonicalValues = new Set(items.filter((item) => item.priority === 1).map((item) => item.value));
    const edgeValues = new Set(items.filter((item) => item.priority > 1).map((item) => item.value));
    const selectedValues = canonicalValues.size > 0 ? canonicalValues : edgeValues;
    if (selectedValues.size > 1) {
      emit(diagnosticCode, { characterId: record.id, values: [...selectedValues], evidenceCount: items.length });
      return { value: null, source: "conflict", conflict: true };
    }
    const value = [...selectedValues][0] ?? null;
    const sourceItem = items.find((item) => item.value === value);
    return { value, source: sourceItem?.source || "unknown", conflict: false };
  };
  const resolveLifeStatus = (record) => {
    const aliveItems = record.alive.filter((item) => item.value === true || item.value === false);
    const hasAlive = aliveItems.some((item) => item.value === true);
    const hasDead = aliveItems.some((item) => item.value === false);
    const hasDeathEvidence = record.deathDate.length > 0 || record.deathDateText.length > 0;
    if (hasAlive && (hasDead || hasDeathEvidence)) {
      emit("RELATION_LIFE_STATUS_CONFLICT", { characterId: record.id, aliveEvidenceCount: aliveItems.length, deathEvidenceCount: record.deathDate.length + record.deathDateText.length });
      return { value: null, source: "conflict", conflict: true };
    }
    if (hasDead || hasDeathEvidence) {
      const sourceItem = aliveItems.find((item) => item.value === false) || record.deathDate[0] || record.deathDateText[0];
      return { value: false, source: sourceItem?.source || "unknown", conflict: false };
    }
    if (hasAlive) return { value: true, source: aliveItems[0].source || "unknown", conflict: false };
    return { value: null, source: "unknown", conflict: false };
  };
  const collectTemporalEvidence = (record, value, priority, sourceOwnerId, relationType, source, relativeAgeContext = {}) => {
    const common = { priority, sourceOwnerId, relationType, source };
    const age = nonnegativeNumber(value?.age);
    if (age !== null && Number.isInteger(age) && priority === 1 && value?.ageSource === "CK3_CURRENT_AGE") {
      record.age.push({ value: age, ageSource: value.ageSource, ...common });
    } else if (age !== null && Number.isInteger(age) && priority > 1 && value?.ageSource === "CK3_LIVE_RELATIVE_AGE") {
      const expectedOwnerId = Number(sourceOwnerId);
      const relativeAgeEvidence = Array.isArray(value?.evidence?.age) ? value.evidence.age : [];
      for (const evidence of relativeAgeEvidence) {
        const evidenceOwnerId = Number(evidence?.sourceOwnerId);
        const evidenceAge = nonnegativeNumber(evidence?.value);
        if (!Number.isSafeInteger(evidenceOwnerId) || evidenceOwnerId <= 0 || evidenceOwnerId !== expectedOwnerId) continue;
        if (evidence?.relationType !== relationType || evidence?.source !== source) continue;
        if (typeof relativeAgeContext?.campaignToken !== "string" || !relativeAgeContext.campaignToken
          || evidence.campaignToken !== relativeAgeContext.campaignToken) continue;
        if (typeof relativeAgeContext?.sourceSnapshotId !== "string" || !relativeAgeContext.sourceSnapshotId
          || evidence.sourceSnapshotId !== relativeAgeContext.sourceSnapshotId) continue;
        if (evidence?.ageSource !== "CK3_LIVE_RELATIVE_AGE" || evidenceAge === null || !Number.isInteger(evidenceAge) || evidenceAge !== age) continue;
        record.age.push({ ...evidence, value: evidenceAge, priority });
      }
    }
    const birthDate = finiteDay(value?.birthDateTotalDays);
    if (birthDate !== null) record.birthDate.push({ value: birthDate, ...common });
    if (value?.birthDate) record.birthDateText.push({ value: value.birthDate, ...common });
    const deathDate = finiteDay(value?.deathDateTotalDays);
    if (deathDate !== null) record.deathDate.push({ value: deathDate, ...common });
    if (value?.deathDate) record.deathDateText.push({ value: value.deathDate, ...common });
    if (value?.deathReason) record.deathReason.push({ value: value.deathReason, ...common });
    if (value?.alive === true) record.alive.push({ value: true, ...common });
    if (value?.alive === false || deathDate !== null || value?.deathDate) record.alive.push({ value: false, ...common });
  };
  const buildCanonicalProfiles = (characters, totalDays, inferGenderFromPronoun, relativeAgeContext = {}) => {
    const records = new Map();
    const getRecord = (id) => {
      if (!records.has(id)) records.set(id, createEvidenceRecord(id));
      return records.get(id);
    };
    for (const character of characters.values()) {
      const id = Number(character?.id);
      if (!Number.isFinite(id)) continue;
      const record = getRecord(id);
      record.canonicalCharacter = character;
      if (character.fullName || character.shortName) record.names.push(character.fullName || character.shortName);
      const gender = normalizeGender(character.gender, character.sheHe, inferGenderFromPronoun);
      record.gender.push({ value: gender, priority: 1, sourceOwnerId: id, relationType: "canonical", source: "characters" });
      collectTemporalEvidence(record, character, 1, id, "canonical", "characters", relativeAgeContext);
    }
    const relationLists = [
      { field: "parents", relationType: "parent" },
      { field: "children", relationType: "child" },
      { field: "siblings", relationType: "sibling" }
    ];
    const positiveRuntimeId = (value) => {
      const numeric = Number(value);
      return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
    };
    const addOtherParentRelation = (childRecord, owner, entry, sourceRelation) => {
      const parent = entry?.otherParent;
      const childId = positiveRuntimeId(childRecord?.id);
      const parentId = positiveRuntimeId(parent?.id ?? parent?.otherParentId);
      const sourceOwnerId = positiveRuntimeId(owner?.id);
      if (!childId || !parentId || !sourceOwnerId || childId === parentId) return;
      const evidenceOwnerId = positiveRuntimeId(parent?.sourceOwnerId);
      if (parent.sourceOwnerId !== undefined && evidenceOwnerId !== sourceOwnerId) return;
      if (parent.childId !== undefined && positiveRuntimeId(parent.childId) !== childId) return;
      if (parent.relationType && parent.relationType !== "parent") return;
      if (parent.source !== "CK3_OTHER_PARENT") return;
      if (parent.knowledgeStatus !== undefined && parent.knowledgeStatus !== "UNKNOWN") return;
      if (parent.sourceRelation && parent.sourceRelation !== sourceRelation) return;
      const campaignFields = ["campaignId", "campaignToken", "sourceSnapshotId", "checkpointId"];
      const evidence = {
        childId,
        parentId,
        otherParentId: parentId,
        parentName: typeof parent.name === "string" && parent.name.trim() ? parent.name : null,
        parentGender: parent.parentGender === "male" || parent.parentGender === "female" ? parent.parentGender : "unknown",
        sourceOwnerId,
        relationType: "parent",
        source: "CK3_OTHER_PARENT",
        sourceRelation,
        publicStatus: parent.publicStatus === "PUBLIC_LEGAL_PARENT" ? "PUBLIC_LEGAL_PARENT" : "UNKNOWN",
        knowledgeStatus: "UNKNOWN"
      };
      for (const field of campaignFields) {
        evidence[field] = parent[field] ?? entry?.[field] ?? owner?.[field] ?? null;
      }
      pushUnique(childRecord.otherParentRelations, evidence, (item) => JSON.stringify(item));
    };
    for (const owner of characters.values()) {
      const ownerId = Number(owner?.id);
      if (!Number.isFinite(ownerId)) continue;
      for (const { field, relationType } of relationLists) {
        for (const entry of owner[field] || []) {
          const id = Number(entry?.id);
          if (!Number.isFinite(id) || !entry?.name) continue;
          const record = getRecord(id);
          record.names.push(entry.name);
          const source = `${ownerId}.${field}`;
          const gender = normalizeGender(entry.gender, entry.sheHe, inferGenderFromPronoun);
          record.gender.push({ value: gender, priority: 2, sourceOwnerId: ownerId, relationType, source });
          collectTemporalEvidence(record, entry, 2, ownerId, relationType, source, relativeAgeContext);
          const directParentEvidence = field === "parents" && (entry.source === "CK3_DIRECT_PARENT" || Object.hasOwn(entry, "publicStatus"))
            ? { source: entry.source, sourceOwnerId: entry.sourceOwnerId, childId: entry.childId,
              relationType: entry.relationType, sourceRelation: entry.sourceRelation, publicStatus: entry.publicStatus,
              knowledgeStatus: entry.knowledgeStatus, campaignToken: entry.campaignToken,
              sourceSnapshotId: entry.sourceSnapshotId, evidenceConflict: entry.evidenceConflict } : null;
          pushUnique(record.relations, { ownerId, relationType, source,
            ...(directParentEvidence ? { directParentEvidence } : {}) }, (item) => `${item.ownerId}:${item.relationType}`);
          if (field === "children") addOtherParentRelation(record, owner, entry, "kids.otherParent");
          else if (field === "siblings") addOtherParentRelation(record, owner, entry, "siblings.otherParent");
        }
      }
    }
    const profiles = new Map();
    for (const record of [...records.values()].sort((left, right) => left.id - right.id)) {
      const canonical = record.canonicalCharacter;
      const name = canonical?.fullName || canonical?.shortName || [...new Set(record.names)].sort((left, right) => left.localeCompare(right))[0];
      if (!name) continue;
      const gender = resolveTieredGender(record);
      const age = resolveTieredAge(record);
      const birthDate = resolveTieredBirthDate(record);
      const birthDateText = resolveTieredValue(record, "birthDateText", "RELATION_CONFLICT_BIRTHDATE_TEXT");
      const alive = resolveLifeStatus(record);
      const deathDate = resolveTieredValue(record, "deathDate", "RELATION_CONFLICT_DEATHDATE");
      const deathDateText = resolveTieredValue(record, "deathDateText", "RELATION_CONFLICT_DEATHDATE_TEXT");
      const deathReason = resolveTieredValue(record, "deathReason", "RELATION_CONFLICT_DEATH_REASON");
      const profile = canonical ? { ...canonical } : {
        id: record.id,
        shortName: name,
        fullName: name,
        firstName: name,
        primaryTitle: "",
        traits: [],
        relationsToCharacters: [],
        relationsToPlayer: [],
        parents: [],
        children: [],
        siblings: [],
        consort: "",
        liege: "",
        isMentionedRelativeProfile: true
      };
      profile.id = record.id;
      profile.fullName = profile.fullName || name;
      profile.shortName = profile.shortName || name;
      profile.firstName = profile.firstName || name;
      profile.gender = gender.value;
      profile.birthDateTotalDays = birthDate.value;
      profile.birthDate = birthDateText.value || profile.birthDate || null;
      profile.alive = alive.value;
      profile.deathDateTotalDays = alive.conflict ? null : deathDate.value;
      profile.deathDate = alive.conflict ? null : deathDateText.value || profile.deathDate || null;
      profile.deathReason = alive.conflict ? null : deathReason.value || profile.deathReason || null;
      profile.age = alive.conflict || alive.value === false ? null : age.value;
      profile.ageSource = alive.conflict ? "LIFE_STATUS_CONFLICT" : alive.value === false ? null : age.source;
      profile.ageEvidenceConflict = age.conflict;
      profile.evidence = {
        canonicalCharacter: canonical || null,
        gender: record.gender.map((item) => ({ ...item })),
        age: record.age.map((item) => ({ ...item })),
        birthDate: record.birthDate.map((item) => ({ ...item })),
        birthDateText: record.birthDateText.map((item) => ({ ...item })),
        alive: record.alive.map((item) => ({ ...item })),
        deathDate: record.deathDate.map((item) => ({ ...item })),
        deathDateText: record.deathDateText.map((item) => ({ ...item })),
        deathReason: record.deathReason.map((item) => ({ ...item })),
        relations: record.relations.map((item) => ({ ...item })),
        otherParentRelations: record.otherParentRelations.map((item) => ({ ...item })),
        resolvedGenderSource: gender.source,
        resolvedBirthSource: birthDate.source,
        conflicts: {
          gender: gender.conflict,
          genderDisagreement: gender.disagreement === true,
          age: age.conflict,
          birthDate: birthDate.conflict,
          alive: alive.conflict,
          lifeStatus: alive.conflict,
          deathDate: deathDate.conflict,
          deathReason: deathReason.conflict
        }
      };
      profiles.set(record.id, profile);
      if (record.gender.length + record.birthDate.length + record.relations.length > 1) {
        emit("RELATION_PROFILE_MERGED", {
          characterId: record.id,
          gender: profile.gender,
          birthDateTotalDays: profile.birthDateTotalDays,
          evidenceCount: record.gender.length + record.birthDate.length + record.relations.length
        });
      }
    }
    return profiles;
  };
  const findFamilyEntry = (entries, characterId) => Array.isArray(entries)
    ? entries.find((entry) => Number(entry?.id) === Number(characterId))
    : void 0;
  const relationTypesBetween = (subject, other) => {
    const types = new Set();
    const add = (value) => {
      if (value) types.add(value);
    };
    const invert = (value) => value === "child" ? "parent" : value === "parent" ? "child" : value;
    for (const evidence of subject?.evidence?.relations || []) {
      if (Number(evidence.ownerId) === Number(other?.id)) add(evidence.relationType);
    }
    for (const evidence of other?.evidence?.relations || []) {
      if (Number(evidence.ownerId) === Number(subject?.id)) add(invert(evidence.relationType));
    }
    if (findFamilyEntry(subject?.parents, other?.id) || findFamilyEntry(other?.children, subject?.id)) add("child");
    if (findFamilyEntry(subject?.children, other?.id) || findFamilyEntry(other?.parents, subject?.id)) add("parent");
    if (findFamilyEntry(subject?.siblings, other?.id) || findFamilyEntry(other?.siblings, subject?.id)) add("sibling");
    return types;
  };
  const resolveSiblingKinship = (subject, other) => {
    const types = relationTypesBetween(subject, other);
    if (!types.has("sibling")) return null;
    const subjectBirth = finiteDay(subject?.birthDateTotalDays) ?? finiteDay(findFamilyEntry(other?.siblings, subject?.id)?.birthDateTotalDays);
    const otherBirth = finiteDay(other?.birthDateTotalDays) ?? finiteDay(findFamilyEntry(subject?.siblings, other?.id)?.birthDateTotalDays);
    const birthConflict = subject?.evidence?.conflicts?.birthDate === true || other?.evidence?.conflicts?.birthDate === true;
    let older = null;
    let birthSource = "unresolved";
    if (!birthConflict && subjectBirth !== null && otherBirth !== null && subjectBirth !== otherBirth) {
      older = subjectBirth < otherBirth;
      birthSource = "exact_birth_date";
    } else if (!birthConflict && (subjectBirth === null || otherBirth === null) && compareCharacterSeniority(subject, other) !== null) {
      older = compareCharacterSeniority(subject, other) > 0;
      birthSource = "integer_age_fallback";
    }
    if (older === null) emit("RELATION_AGE_UNRESOLVED", { subjectId: subject?.id, otherId: other?.id, subjectBirth, otherBirth, birthConflict });
    const gender = subject?.gender === "male" || subject?.gender === "female" ? subject.gender : "unknown";
    let label;
    if (gender === "male") label = older === true ? "哥哥" : older === false ? "弟弟" : "兄弟";
    else if (gender === "female") label = older === true ? "姐姐" : older === false ? "妹妹" : "姐妹";
    else label = older === true ? "年长手足" : older === false ? "年幼手足" : "手足";
    return { type: "sibling", label, gender, subjectBirth, otherBirth, birthSource, evidenceCount: subject?.evidence?.relations?.length || 0 };
  };
  const resolveDirectKinship = (subject, other) => {
    if (!subject || !other || Number(subject.id) === Number(other.id)) return null;
    const types = relationTypesBetween(subject, other);
    if (types.size > 1) {
      emit("RELATION_CONFLICT_TYPE", { subjectId: subject.id, otherId: other.id, types: [...types] });
      return null;
    }
    let resolution = null;
    if (types.has("child")) {
      resolution = { type: "child", label: subject.gender === "male" ? "儿子" : subject.gender === "female" ? "女儿" : "子女", gender: subject.gender || "unknown" };
    } else if (types.has("parent")) {
      resolution = { type: "parent", label: subject.gender === "male" ? "父亲" : subject.gender === "female" ? "母亲" : "父母", gender: subject.gender || "unknown" };
    } else if (types.has("sibling")) {
      resolution = resolveSiblingKinship(subject, other);
    }
    if (resolution) {
      emit("RELATION_RESOLUTION", {
        subjectId: subject.id,
        otherId: other.id,
        subjectName: subject.fullName || subject.shortName,
        resolvedType: resolution.type,
        resolvedLabel: resolution.label,
        gender: resolution.gender,
        genderSource: subject?.evidence?.resolvedGenderSource || "character",
        subjectBirth: resolution.subjectBirth ?? finiteDay(subject.birthDateTotalDays),
        otherBirth: resolution.otherBirth ?? finiteDay(other.birthDateTotalDays),
        birthSource: resolution.birthSource || subject?.evidence?.resolvedBirthSource || "unknown",
        evidenceCount: resolution.evidenceCount ?? subject?.evidence?.relations?.length ?? 0
      });
    }
    return resolution;
  };
  return { buildCanonicalProfiles, resolveDirectKinship, resolveSiblingKinship, findFamilyEntry };
}

module.exports = { createRelationshipResolver };
