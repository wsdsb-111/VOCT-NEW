"use strict";

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
    birthDate: [],
    relations: []
  });
  const pushUnique = (items, value, key) => {
    if (!items.some((item) => key(item) === key(value))) items.push(value);
  };
  const resolveTieredGender = (record) => {
    const canonicalValues = new Set(record.gender.filter((item) => item.priority === 1 && item.value !== "unknown").map((item) => item.value));
    const edgeValues = new Set(record.gender.filter((item) => item.priority > 1 && item.value !== "unknown").map((item) => item.value));
    const selectedValues = canonicalValues.size > 0 ? canonicalValues : edgeValues;
    if (selectedValues.size > 1) {
      emit("RELATION_CONFLICT_GENDER", { characterId: record.id, values: [...selectedValues], evidenceCount: record.gender.length });
      return { value: "unknown", source: "conflict", conflict: true };
    }
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
  const buildCanonicalProfiles = (characters, totalDays, inferGenderFromPronoun) => {
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
      const birthDate = finiteDay(character.birthDateTotalDays);
      if (birthDate !== null) record.birthDate.push({ value: birthDate, priority: 1, sourceOwnerId: id, relationType: "canonical", source: "characters" });
    }
    const relationLists = [
      { field: "parents", relationType: "parent" },
      { field: "children", relationType: "child" },
      { field: "siblings", relationType: "sibling" }
    ];
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
          const birthDate = finiteDay(entry.birthDateTotalDays);
          if (birthDate !== null) record.birthDate.push({ value: birthDate, priority: 2, sourceOwnerId: ownerId, relationType, source });
          pushUnique(record.relations, { ownerId, relationType, source }, (item) => `${item.ownerId}:${item.relationType}`);
        }
      }
    }
    const profiles = new Map();
    for (const record of [...records.values()].sort((left, right) => left.id - right.id)) {
      const canonical = record.canonicalCharacter;
      const name = canonical?.fullName || canonical?.shortName || [...new Set(record.names)].sort((left, right) => left.localeCompare(right))[0];
      if (!name) continue;
      const gender = resolveTieredGender(record);
      const birthDate = resolveTieredBirthDate(record);
      const age = birthDate.value !== null && Number.isFinite(Number(totalDays))
        ? Math.max(0, Math.floor((Number(totalDays) - birthDate.value) / 365.2425))
        : Number.isFinite(Number(canonical?.age)) ? Number(canonical.age) : null;
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
      profile.age = age;
      profile.evidence = {
        canonicalCharacter: canonical || null,
        gender: record.gender.map((item) => ({ ...item })),
        birthDate: record.birthDate.map((item) => ({ ...item })),
        relations: record.relations.map((item) => ({ ...item })),
        resolvedGenderSource: gender.source,
        resolvedBirthSource: birthDate.source,
        conflicts: { gender: gender.conflict, birthDate: birthDate.conflict }
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
    } else if (!birthConflict && Number.isFinite(Number(subject?.age)) && Number.isFinite(Number(other?.age)) && Number(subject.age) !== Number(other.age)) {
      older = Number(subject.age) > Number(other.age);
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
