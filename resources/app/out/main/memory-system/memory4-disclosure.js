"use strict";

const { assertScope, hash, ids } = require("./memory4-contract");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");
const { normalizeTraitKey, getTraitAliases } = require("../prompts/trait-profile-selector");

const TITLE_RANKS = new Map([
  ["barony", { value: "男爵", aliases: ["Baron", "男爵领"] }],
  ["county", { value: "伯爵", aliases: ["Count", "County", "伯爵领"] }],
  ["duchy", { value: "公爵", aliases: ["Duke", "Duchy", "公爵领"] }],
  ["kingdom", { value: "国王", aliases: ["King", "Kingdom", "王国"] }],
  ["empire", { value: "皇帝", aliases: ["Emperor", "Empire", "帝国"] }]
]);

function normalizedText(value) {
  return typeof value === "string" ? value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ") : "";
}

function titleFactKey(value) {
  return `title_${normalizedText(value).replace(/\s+/g, "_")}`;
}

function traitFactKey(value) {
  const canonical = normalizeTraitKey(value);
  return canonical ? `trait_${canonical}` : "";
}

function uniqueText(values) {
  return [...new Set(values.map(normalizedText).filter(Boolean))];
}

function spokenAgeNumber(value) {
  if (/^\d{1,4}$/.test(value)) return Number(value);
  if (!/^[零〇一二两三四五六七八九十百千]+$/.test(value) || value.length > 1 && !/[十百千]/.test(value)) return null;
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units = { 十: 10, 百: 100, 千: 1000 };
  let total = 0, pending = null;
  for (const character of value) {
    if (Object.hasOwn(digits, character)) pending = digits[character];
    else if (Object.hasOwn(units, character)) {
      total += (pending ?? 1) * units[character];
      pending = null;
    } else return null;
  }
  return total + (pending ?? 0);
}

function isCurrentAgeAssertion(sentence, targetAliases, fact, fragment) {
  const age = Number(fact?.value);
  const selfAliases = new Set(["我", "吾", "朕", "寡人", "孤", "本王", "在下", "鄙人", "本人"]);
  if (fact?.factType !== "AGE" || !Number.isSafeInteger(age) || age < 0
    || !Number.isSafeInteger(Number(fragment?.speakerId)) || Number(fragment.speakerId) <= 0
    || !Array.isArray(targetAliases) || !targetAliases.some(alias => selfAliases.has(normalizedText(alias)))) return false;
  const match = String(sentence || "").normalize("NFKC").trim().match(/^(?:我|吾|朕|寡人|孤|本王|在下|鄙人|本人)\s*(?:(?:今年|现在|如今|当前)\s*)?([0-9]{1,4}|[零〇一二两三四五六七八九十百千]+)\s*岁(?:了)?$/);
  return !!match && spokenAgeNumber(match[1]) === age;
}

function ageFactKey(age) {
  return `age_${age}`;
}

function normalizeCandidate(candidate) {
  if (!candidate || !["TITLE", "TRAIT", "AGE"].includes(candidate.factType)) return null;
  if (candidate.factType === "AGE") {
    const value = typeof candidate.value === "number" ? candidate.value
      : typeof candidate.value === "string" && /^\d+$/.test(candidate.value.trim()) ? Number(candidate.value.trim()) : NaN;
    if (!Number.isSafeInteger(value) || value < 0) return null;
    const canonicalKey = String(value);
    const factKey = ageFactKey(canonicalKey);
    if (candidate.factKey && candidate.factKey !== factKey) return null;
    return { factType: "AGE", factKey, canonicalKey, value: canonicalKey, aliases: [] };
  }
  const value = typeof candidate.value === "string" ? candidate.value.trim() : "";
  if (!value) return null;
  if (candidate.factType === "TITLE" && /^(?:none(?:\s|$)|concept_none|无|无主要头衔)$/i.test(value)) return null;
  const canonicalKey = candidate.factType === "TITLE"
    ? normalizedText(value)
    : normalizeTraitKey({ traitId: candidate.canonicalKey || candidate.traitId || candidate.key || candidate.id || value });
  const factKey = candidate.factType === "TITLE" ? titleFactKey(value) : `trait_${canonicalKey}`;
  if (!canonicalKey || candidate.factKey && candidate.factKey !== factKey) return null;
  const traitAliases = candidate.factType === "TRAIT" ? getTraitAliases({ traitId: canonicalKey, name: value,
    localizedName: candidate.localizedName, key: candidate.key, id: candidate.id }) : [];
  const aliases = uniqueText([value, candidate.canonicalKey, candidate.traitId, candidate.key, candidate.id,
    ...traitAliases, ...(Array.isArray(candidate.aliases) ? candidate.aliases : [])]);
  return { factType: candidate.factType, factKey, canonicalKey, value, aliases };
}

function getFactCandidates(character) {
  if (!character || typeof character !== "object") return [];
  const currentAge = normalizeCandidate({ factType: "AGE", value: character.age });
  if (Array.isArray(character.facts)) {
    const facts = character.facts.map(candidate => candidate?.factType === "AGE" && !candidate.factKey ? null : normalizeCandidate(candidate)).filter(Boolean);
    const embeddedAges = new Map(facts.filter(candidate => candidate.factType === "AGE").map(candidate => [candidate.factKey, candidate]));
    const age = currentAge || (character.age == null && embeddedAges.size === 1 ? [...embeddedAges.values()][0] : null);
    const candidates = [...facts.filter(candidate => candidate.factType !== "AGE"), ...(age ? [age] : [])];
    return mergeCandidates(candidates);
  }
  const candidates = currentAge ? [currentAge] : [];
  const addTitle = (value, extraAliases = []) => {
    const candidate = normalizeCandidate({ factType: "TITLE", value: typeof value === "string" ? value : value?.value || value?.name || value?.localizedName,
      aliases: [...(typeof value === "object" && Array.isArray(value.aliases) ? value.aliases : []), ...extraAliases] });
    if (candidate) candidates.push(candidate);
  };
  addTitle(character.primaryTitle);
  const rankText = normalizedText(character.titleRankConcept).replace(/^concept_|^title_rank_/, "");
  const rank = TITLE_RANKS.get(rankText);
  if (rank) addTitle(rank.value, [...rank.aliases, character.titleRankConcept]);
  const positions = Array.isArray(character.heldCourtAndCouncilPositions)
    ? character.heldCourtAndCouncilPositions : String(character.heldCourtAndCouncilPositions || "").split(/[,，、;；\n|]/);
  for (const position of positions) addTitle(position);
  for (const title of [...(Array.isArray(character.titles) ? character.titles : []),
    ...(Array.isArray(character.titleCandidates) ? character.titleCandidates : [])]) addTitle(title);
  for (const trait of Array.isArray(character.traits) ? character.traits : []) {
    const value = typeof trait === "string" ? trait : trait?.localizedName || trait?.name || trait?.value;
    const candidate = normalizeCandidate({ factType: "TRAIT", value,
      canonicalKey: typeof trait === "object" ? trait.traitId || trait.key || trait.id : null,
      aliases: [...getTraitAliases(trait), ...(typeof trait === "object"
        ? [trait.shortName, trait.alias, ...(Array.isArray(trait.aliases) ? trait.aliases : [])] : [])] });
    if (candidate) candidates.push(candidate);
  }
  return mergeCandidates(candidates);
}

function mergeCandidates(candidates) {
  const byKey = new Map();
  for (const candidate of candidates) {
    const previous = byKey.get(candidate.factKey);
    if (!previous) byKey.set(candidate.factKey, candidate);
    else previous.aliases = uniqueText([...previous.aliases, ...candidate.aliases]);
  }
  return [...byKey.values()].sort((left, right) => left.factType.localeCompare(right.factType) || left.factKey.localeCompare(right.factKey));
}

function disclosureFactId(scope, entityId, factType, factKey) {
  return hash([scope.campaignToken, scope.ownerId, entityId, factType, factKey]);
}

function characterRows(gameData) {
  const characters = gameData?.characters;
  if (characters instanceof Map) return [...characters.values()];
  if (Array.isArray(characters)) return characters;
  if (characters && typeof characters === "object") return Object.values(characters);
  return [];
}

function characterId(character) {
  const id = Number(character?.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function characterAliases(character) {
  return uniqueText([...(Array.isArray(character?.names) ? character.names : []), character?.fullName,
    character?.shortName, character?.firstName, character?.name]);
}

function occurrences(text, alias) {
  const found = [];
  let start = 0;
  while ((start = text.indexOf(alias, start)) >= 0) {
    const end = start + alias.length;
    if (!/^[a-z0-9 ]+$/i.test(alias)
      || (!/[\p{L}\p{N}_-]/u.test(text[start - 1] || "") && !/[\p{L}\p{N}_-]/u.test(text[end] || ""))) found.push({ start, end, alias });
    start = end;
  }
  return found;
}

function longestOccurrences(items) {
  return items.filter(item => !items.some(other => other.start <= item.start && other.end >= item.end
    && other.end - other.start > item.end - item.start));
}

function matchedTargetAliases(text, characters, fragment) {
  const rows = [];
  for (const character of characters.values()) {
    const id = characterId(character);
    if (!id) continue;
    for (const alias of characterAliases(character)) for (const occurrence of occurrences(text, alias)) rows.push({ ...occurrence, id });
  }
  const spans = new Map();
  for (const row of longestOccurrences(rows)) {
    const key = `${row.start}:${row.end}`;
    if (!spans.has(key)) spans.set(key, new Set());
    spans.get(key).add(row.id);
  }
  const aliasesById = new Map();
  const uniqueRows = longestOccurrences(rows).filter(row => spans.get(`${row.start}:${row.end}`)?.size === 1);
  for (const row of uniqueRows) {
    if (!aliasesById.has(row.id)) aliasesById.set(row.id, new Set());
    aliasesById.get(row.id).add(row.alias);
  }
  const speakerId = Number(fragment.speakerId);
  if (Number.isSafeInteger(speakerId) && speakerId > 0) for (const alias of ["我", "吾", "朕", "寡人", "孤", "本王", "在下", "鄙人", "本人", "i", "myself"]) {
    if (occurrences(text, alias).length) {
      if (!aliasesById.has(speakerId)) aliasesById.set(speakerId, new Set());
      aliasesById.get(speakerId).add(alias);
    }
  }
  for (const id of aliasesById.keys()) if (!ids(fragment.entityIds).includes(id) && id !== speakerId) aliasesById.delete(id);
  return aliasesById;
}

function matchedFacts(text, facts) {
  const matches = [];
  for (const fact of facts) for (const alias of fact.aliases) {
    for (const occurrence of occurrences(text, alias)) matches.push({ ...occurrence, factId: fact.factKey });
  }
  const spans = new Map();
  const longest = longestOccurrences(matches);
  for (const row of longest) {
    const key = `${row.start}:${row.end}`;
    if (!spans.has(key)) spans.set(key, new Set());
    spans.get(key).add(row.factId);
  }
  return [...new Set(longest.filter(row => spans.get(`${row.start}:${row.end}`)?.size === 1).map(row => row.factId))];
}

const UNCERTAIN = /[?？]|吗|么|可否|能否|是不是|是否|不是|并非|并不|未必|没有|从未|不曾|未曾|不再是|不属实|否认|听说|据说|传闻|传言|谣言|相传|声称|自称|据传|可能|也许|或许|似乎|疑似|假如|如果|要是|倘若|将来|未来|终将|迟早|尚未|未证实|玩笑|虚构|误传|我猜|猜测|我想|以为|怀疑|认为|觉得|心想|心里|内心|心中|暗自|旁白|叙述|描写|\b(?:not|never|rumou?r|heard|alleged|claims?|said|might|may|perhaps|possibly|suppose|think|thought|thinking|believe|seem|if|whether|unless|will|would|future|intends?|intention|joking|fiction|unconfirmed|narration|aside)\b/i;
const DISCOURSE = /说|告诉|提到|声称|认为|觉得|怀疑|听说|据说|传闻|引用|否认|谣传/;
const PREDICATES = /(?:(?:当前|如今|当今|现在|其实|确实|仍然|本来|向来|天生|生性|真正|正是|就是|确为|乃是|是|乃|为|系|拥有|具有|具备|患有|身患|有|很|非常|十分|极其|异常)|\b(?:am|is|are|has|have|possesses|born|very)\b|['’]s\b)/i;
const SPEAKER_SELF_ALIASES = new Set(["我", "吾", "朕", "寡人", "孤", "本王", "在下", "鄙人", "本人", "i", "myself"]);

function assertedBetween(text, targetAliases, factAliases, otherTargetAliases = []) {
  for (const targetAlias of targetAliases) for (const target of occurrences(text, targetAlias)) {
    for (const factAlias of factAliases) for (const fact of occurrences(text, factAlias)) {
      if (fact.start < target.end || fact.start - target.end > 40) continue;
      const between = text.slice(target.end, fact.start);
      if (otherTargetAliases.some(alias => occurrences(between, alias).length) || DISCOURSE.test(between)
        || /不|未|没|非|无/.test(between)) continue;
      if (PREDICATES.test(between)) return true;
    }
  }
  return false;
}

function sourceMessageIds(fragment, sourceKind) {
  const values = Array.isArray(fragment.sourceMessageIds) ? fragment.sourceMessageIds : [fragment.messageId];
  if (sourceKind !== "LETTER" && (!values.length || values.some(id => !Number.isSafeInteger(id) || id < 0))) return [];
  const result = [...new Set(values.filter(id => Number.isSafeInteger(id) && id >= 0))].sort((a, b) => a - b);
  return sourceKind === "LETTER" ? [] : result;
}

function eligibleFragment(snapshot, fragment, sourceKind, letterProof = null) {
  if (!fragment || typeof fragment.text !== "string" || !fragment.text.trim()
    || typeof fragment.fragmentId !== "string" || !fragment.fragmentId
    || !ids(fragment.knownBy).includes(snapshot.ownerId) || fragment.sourceType !== "spoken") return false;
  if (sourceKind === "LETTER") return !!letterProof && fragment.visibilityEvidence === "validated_letter"
    && fragment.sourceLetterId === letterProof.letterId && Number(fragment.speakerId) === letterProof.senderId
    && Number(snapshot.ownerId) === letterProof.recipientId && ids(fragment.knownBy).join() === String(letterProof.recipientId)
    && fragment.visibility === "private";
  if (!["public", "participants", "known_group"].includes(fragment.visibility)) return false;
  if (fragment.visibilityEvidence === "application_fragment") return sourceMessageIds(fragment, "CONVERSATION").length > 0;
  return ["finalization_validated_segment", "finalization_source_paragraph"].includes(fragment.visibilityEvidence)
    && fragment.sourceTextVerified === true
    && sourceMessageIds(fragment, "CONVERSATION").length > 0;
}

function scanSource(snapshot, gameData, sourceKind, letterProof = null) {
  assertScope(snapshot);
  if (!/^[a-f0-9]{64}$/.test(snapshot.sourceRevision || "") || !snapshot.date || !normalizeGameDate(snapshot.date)
    || gameData?.campaignToken !== snapshot.campaignToken) return { disclosures: [], skipped: "source_scope_or_date_invalid" };
  const characters = new Map(characterRows(gameData).map(character => [characterId(character), character]).filter(([id]) => id));
  if (!characters.size) return { disclosures: [], skipped: "disclosure_characters_missing" };
  const fragments = Array.isArray(snapshot.fragments) ? snapshot.fragments : [];
  const byFact = new Map();
  for (const fragment of fragments) {
    if (!eligibleFragment(snapshot, fragment, sourceKind, letterProof)) continue;
    const messageIds = sourceMessageIds(fragment, sourceKind);
    const pieces = fragment.text.split(/([。.!！?？;；\r\n]+)/);
    for (let index = 0; index < pieces.length; index += 2) {
      const sentence = `${pieces[index] || ""}${pieces[index + 1] || ""}`.trim();
      if (!sentence) continue;
      if (UNCERTAIN.test(sentence)) continue;
      // A speaker's own delivery cue is not somebody else's attributed claim.
      const attributedSpeech = [...sentence.matchAll(/说(?:道|过)?|表示|宣称|转述|引用/g)].some(match => {
        const subject = sentence.slice(0, match.index).split(/[,，:：]/).at(-1).trim();
        return !subject || !/^(?:我|吾|朕|寡人|孤|本王|在下|鄙人|本人)?(?:低声|轻声|高声|大声|小声|悄声)?$/.test(subject);
      });
      if (attributedSpeech) continue;
      const targetAliasesById = matchedTargetAliases(sentence, characters, fragment);
      for (const [entityId, targetAliases] of targetAliasesById) {
        if (entityId === snapshot.ownerId) continue;
        const character = characters.get(entityId);
        const facts = getFactCandidates(character);
        const matched = new Set(matchedFacts(sentence, facts));
        const otherTargetAliases = uniqueText([...characters.values()].filter(candidate => characterId(candidate) !== entityId)
          .flatMap(characterAliases));
        for (const fact of facts) {
          const aliases = uniqueText([...targetAliases]);
          const ageAssertion = fact.factType === "AGE"
            ? isCurrentAgeAssertion(sentence.replace(/[。.!！?？;；]+$/u, "").trim(), aliases, fact, fragment) : false;
          if (fact.factType === "AGE" ? !ageAssertion : !matched.has(fact.factKey)) continue;
          if (fragment.sourceRole === "mixed") continue;
          if (fragment.sourceRole === "assistant"
            && (entityId !== Number(fragment.speakerId) || !aliases.some(alias => SPEAKER_SELF_ALIASES.has(alias)))) continue;
          if (fact.factType !== "AGE" && !assertedBetween(sentence, aliases, fact.aliases, otherTargetAliases)) continue;
          const factId = disclosureFactId(snapshot, entityId, fact.factType, fact.factKey);
          let disclosure = byFact.get(factId);
          if (!disclosure) {
            disclosure = { factId, entityId, factType: fact.factType, factKey: fact.factKey, value: fact.value, evidence: {
              sourceMessageIds: [], sourceFragmentIds: [], visibilityEvidence: [], sourceTextHashes: [] } };
            byFact.set(factId, disclosure);
          }
          disclosure.evidence.sourceMessageIds.push(...messageIds);
          disclosure.evidence.sourceFragmentIds.push(fragment.fragmentId);
          disclosure.evidence.visibilityEvidence.push(fragment.visibilityEvidence);
          disclosure.evidence.sourceTextHashes.push(hash(fragment.text));
        }
      }
    }
  }
  const disclosures = [...byFact.values()].map(disclosure => ({ ...disclosure, evidence: {
    ...disclosure.evidence,
    sourceMessageIds: [...new Set(disclosure.evidence.sourceMessageIds)].sort((a, b) => a - b),
    sourceFragmentIds: [...new Set(disclosure.evidence.sourceFragmentIds.filter(Boolean))].sort(),
    visibilityEvidence: [...new Set(disclosure.evidence.visibilityEvidence)].sort(),
    sourceTextHashes: [...new Set(disclosure.evidence.sourceTextHashes)].sort()
  } }));
  return { disclosures, skipped: null };
}

function scanVisibleDisclosures(snapshot, gameData) {
  if (snapshot?.sourceKind === "LETTER") return { disclosures: [], skipped: "letter_source_requires_delivery_gate" };
  if (snapshot?.sourceKind && snapshot.sourceKind !== "CONVERSATION") return { disclosures: [], skipped: "source_kind_invalid" };
  return scanSource(snapshot, gameData, "CONVERSATION");
}

module.exports = { getFactCandidates, disclosureFactId, isCurrentAgeAssertion, scanVisibleDisclosures, scanLetterDisclosures: scanSource };
