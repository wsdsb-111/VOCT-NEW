"use strict";

const { assertScope, hash, ids } = require("./memory4-contract");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");
const { normalizeTraitKey, getTraitAliases } = require("../prompts/trait-visibility-policy");
const { directSpeechSpans } = require("./memory4-entity-context");

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

const SELF_AGE_PRONOUNS = ["我", "吾", "朕", "寡人", "孤", "本王", "在下", "鄙人", "本人"];
const SPOKEN_AGE_NUMBER = "[0-9]{1,4}|[零〇一二两三四五六七八九十百千]+";

function parseCurrentAgeValue(sentence, targetAliases, fragment) {
  if (!Number.isSafeInteger(Number(fragment?.speakerId)) || Number(fragment.speakerId) <= 0
    || !Array.isArray(targetAliases)) return null;
  const text = String(sentence || "").normalize("NFKC").trim();
  const selfPrefix = `(?:${SELF_AGE_PRONOUNS.join("|")})\\s*`;
  const number = `(${SPOKEN_AGE_NUMBER})`;
  const comparison = "(?:\\s*[,，]?\\s*比(?:你|您)(?:年纪)?大(?:[0-9]{1,4}|[零〇一二两三四五六七八九十百千]+)\\s*岁?)?";
  const selfTarget = targetAliases.some(alias => SELF_AGE_PRONOUNS.includes(normalizedText(alias)));
  const selfPatterns = [
    new RegExp(`^${selfPrefix}(?:(?:今年|现在|如今|当前)\\s*)?${number}\\s*岁(?:了)?${comparison}$`, "u"),
    new RegExp(`^${selfPrefix}(?:的)?年龄\\s*(?:(?:今年|现在|如今|当前)\\s*)?(?:是|为)\\s*${number}\\s*岁(?:了)?$`, "u"),
    new RegExp(`^${selfPrefix}(?:(?:已经|已)?活了)\\s*${number}\\s*(?:岁|年|载)$`, "u")
  ];
  if (selfTarget) {
    for (const pattern of selfPatterns) {
      const match = text.match(pattern);
      if (match) return spokenAgeNumber(match[1]);
    }
  }
  for (const alias of targetAliases.filter(value => value && !SELF_AGE_PRONOUNS.includes(normalizedText(value))).sort((a, b) => b.length - a.length)) {
    const escaped = String(alias).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(new RegExp(`^${escaped}\\s*(?:(?:今年|现在|如今|当前)\\s*)?${number}\\s*岁(?:了)?$`, "u"));
    if (match) return spokenAgeNumber(match[1]);
  }
  return null;
}

function parseBareCurrentAgeAnswer(sentence) {
  const text = String(sentence || "").normalize("NFKC").trim().replace(/[。.!！?？;；]+$/u, "").trim();
  const match = text.match(new RegExp(`^(?:(?:今年|现在|如今|当前)\\s*)?(${SPOKEN_AGE_NUMBER})\\s*岁(?:了)?$`, "u"));
  return match ? spokenAgeNumber(match[1]) : null;
}

function isCurrentAgeAssertion(sentence, targetAliases, fact, fragment) {
  const age = Number(fact?.value);
  if (fact?.factType !== "AGE" || !Number.isSafeInteger(age) || age < 0
    || !Number.isSafeInteger(Number(fragment?.speakerId)) || Number(fragment.speakerId) <= 0
    || !Array.isArray(targetAliases)) return false;
  return parseCurrentAgeValue(sentence, targetAliases, fragment) === age;
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
    : normalizeTraitKey({ traitId: candidate.canonicalKey || candidate.traitId || candidate.key || candidate.id,
      name: value });
  const factKey = candidate.factType === "TITLE" ? titleFactKey(value) : `trait_${canonicalKey}`;
  if (!canonicalKey || candidate.factKey && candidate.factKey !== factKey) return null;
  const traitAliases = candidate.factType === "TRAIT" ? getTraitAliases({ traitId: canonicalKey, name: value,
    localizedName: candidate.localizedName, key: candidate.key, id: candidate.id }) : [];
  const aliases = uniqueText([value, candidate.canonicalKey, candidate.traitId, candidate.key, candidate.id,
    ...traitAliases, ...(Array.isArray(candidate.aliases) ? candidate.aliases : [])]);
  return { factType: candidate.factType, factKey, canonicalKey, value, aliases,
    ...(candidate.factType === "TRAIT" && typeof candidate.category === "string" ? { category: candidate.category } : {}) };
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
      category: trait?.category,
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
    character?.shortName, character?.firstName, character?.name, character?.nickname]);
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
  const aliasOwners = new Map();
  for (const character of characters.values()) {
    const id = characterId(character);
    if (!id) continue;
    for (const alias of characterAliases(character)) {
      if (!aliasOwners.has(alias)) aliasOwners.set(alias, new Set());
      aliasOwners.get(alias).add(id);
    }
  }
  for (const [alias, owners] of aliasOwners) {
    if (owners.size !== 1) continue;
    const id = [...owners][0];
    for (const occurrence of occurrences(text, alias)) rows.push({ ...occurrence, id });
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

const UNCERTAIN = /[?？]|吗|么|可否|能否|是不是|是否|不是|并非|并不|未必|没有|从未|不曾|未曾|不再是|不属实|否认|听说|据说|传闻|传言|谣言|相传|声称|自称|据传|可能|也许|或许|似乎|疑似|假如|如果|要是|倘若|将来|未来|明年|后年|终将|迟早|尚未|未证实|曾经|曾为|曾任|当年|昔日|往日|过去|以前|原先|玩笑|虚构|误传|我猜|猜测|我想|以为|怀疑|认为|觉得|心想|暗想|心里|内心|心中|暗自|旁白|叙述|描写|\b(?:not|never|rumou?r|heard|alleged|claims?|said|might|may|perhaps|possibly|suppose|think|thought|thinking|believe|seem|if|whether|unless|will|would|future|intends?|intention|joking|fiction|unconfirmed|narration|aside)\b/i;
const DISCOURSE = /说|告诉|提到|声称|认为|觉得|怀疑|听说|据说|传闻|引用|否认|谣传/;
const FUTURE_MODAL = /(?:即将|将要|将会|将是|将为|将成为|将任|将担任|会成为|会是|会任|会担任|马上要|快要|准备|打算|计划|想要|要成为|\b(?:will|intend(?:s)?\s+to|plan(?:s)?\s+to|be\s+going\s+to|about\s+to)\b)/iu;
const FUTURE_TIME = /(?:明天|明日|后天|下月|下个月|来月|来年|以后|之后|届时|未来|将来)/iu;
const PREDICATES = /(?:(?:当前|如今|当今|现在|其实|确实|仍然|本来|向来|天生|生性|真正|正是|就是|确为|乃是|已(?:经)?成为|是|乃|为|系|拥有|具有|具备|患有|身患|有|很|非常|十分|极其|异常)|\b(?:am|is|are|has|have|possesses|born|very)\b|['’]s\b)/i;
const SPEAKER_SELF_ALIASES = new Set(["我", "吾", "朕", "寡人", "孤", "本王", "在下", "鄙人", "本人", "i", "myself"]);
const SELF_PRONOUN_PREFIX = /^(?:我|吾|朕|寡人|孤|本王|在下|鄙人|本人)\s*/u;
const SELF_ATTRIBUTE_HEAD = /^(?:即将|将要|将会|将是|将为|将成为|将任|将担任|会成为|会是|会任|会担任|以后会|之后会|届时会|未来会|马上要|快要|准备|打算|计划|想要|要|已(?:经)?(?:成为|是)|现在|如今|当前|目前|现任|现为|其实|确实|仍然|本来|向来|天生|生性|正是|就是|确为|乃是|乃|是|为|系|拥有|具有|具备|患有|身患|有|很|非常|十分|极其|异常)/u;
const SELF_LABELED_FACT_HEAD = /^(?:的)?(?:头衔|身份|职位|官职|特质|性格|特点|能力|年龄)\s*(?:(?:现在|如今|当前|今年)\s*)?(?:是|为|乃|确为|就是)/u;
const SELF_AGE_HEAD = /^(?:(?:(?:今年|现在|如今|当前)\s*)?(?:[0-9]{1,4}|[零〇一二两三四五六七八九十百千]+)\s*岁|(?:已经|已)?活了\s*(?:[0-9]{1,4}|[零〇一二两三四五六七八九十百千]+)\s*(?:岁|年|载))/u;
const ENGLISH_SELF_ASSERTION_HEAD = /^(?:i\s*(?:am|'m)|myself\s+(?:am|is|are|have|has|possess(?:es)?|born|very)\b)/i;
const RELATIONAL_FACT_SUFFIX = /^\s*(?:(?:的|之|地)\s*[\p{L}\p{N}_]|['’]s\s*[\p{L}\p{N}_])/iu;

function assistantSelfAssertions(text) {
  const pieces = String(text || "").split(/([。.!！?？;；\r\n]+)/u);
  const sentences = [];
  for (let index = 0; index < pieces.length; index += 2) {
    const sentence = `${pieces[index] || ""}${pieces[index + 1] || ""}`.trim();
    const selfPrefix = sentence.match(SELF_PRONOUN_PREFIX);
    const remainder = selfPrefix ? sentence.slice(selfPrefix[0].length) : "";
    const explicitSelfAssertion = selfPrefix
      ? SELF_ATTRIBUTE_HEAD.test(remainder) || SELF_LABELED_FACT_HEAD.test(remainder) || SELF_AGE_HEAD.test(remainder)
      : ENGLISH_SELF_ASSERTION_HEAD.test(sentence);
    if (sentence && explicitSelfAssertion && !UNCERTAIN.test(sentence)) sentences.push(sentence);
  }
  return sentences;
}

function assertedBetween(text, targetAliases, factAliases, otherTargetAliases = []) {
  let reasonCode = null;
  for (const targetAlias of targetAliases) for (const target of occurrences(text, targetAlias)) {
    for (const factAlias of factAliases) for (const fact of occurrences(text, factAlias)) {
      if (fact.start < target.end || fact.start - target.end > 40) continue;
      const suffix = text.slice(fact.end);
      if (/^\s*地\s*[\p{L}\p{N}_]/iu.test(suffix)) { reasonCode = "disclosure_adverb_rejected"; continue; }
      if (RELATIONAL_FACT_SUFFIX.test(suffix)) continue;
      const between = text.slice(target.end, fact.start);
      if (otherTargetAliases.some(alias => occurrences(between, alias).length) || DISCOURSE.test(between)
        || /不|未|没|非|无/.test(between)) continue;
      if (FUTURE_MODAL.test(text) || FUTURE_TIME.test(text)) { reasonCode = "disclosure_future_rejected"; continue; }
      if (PREDICATES.test(between)) return { accepted: true, reasonCode: null };
    }
  }
  return { accepted: false, reasonCode };
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

function ageQuestionTarget(fragment, characters) {
  const texts = [fragment.text, ...(fragment.sourceRole === "assistant"
    ? directSpeechSpans(fragment.text, characterAliases(characters.get(Number(fragment.speakerId))),
      { speakerId: fragment.speakerId, characters }).map(span => span.text) : [])];
  const questionEnd = /^(?:(?:今年|现在|如今|当前))?(?:多少岁|几岁|多大)[?？。！!\s]*$/u;
  const targets = new Set();
  for (const sourceText of texts) {
    const text = normalizedText(sourceText);
    const namedTargets = new Set();
    for (const character of characters.values()) {
      for (const alias of characterAliases(character)) {
        if (!text.startsWith(alias)) continue;
        const remainder = text.slice(alias.length).replace(/^[,，:：\s]+/u, "").replace(/^(?:你|您)/u, "");
        if (questionEnd.test(remainder)) namedTargets.add(characterId(character));
      }
    }
    if (namedTargets.size > 1) return null;
    if (namedTargets.size === 1) { targets.add([...namedTargets][0]); continue; }
    if (!/^(?:你|您)/u.test(text) || !questionEnd.test(text.replace(/^(?:你|您)/u, ""))) continue;
    // Recipient IDs may denote the whole audience, not the addressed responder.
    const present = ids(fragment.presentIds);
    const others = present.filter(id => id !== Number(fragment.speakerId));
    if (present.length !== 2 || others.length !== 1) return null;
    targets.add(others[0]);
  }
  return targets.size === 1 ? [...targets][0] : null;
}

function latestAgeQuestion(snapshot, answerFragment, sourceKind, characters) {
  const ownerId = Number(snapshot.ownerId);
  const speakerId = Number(answerFragment.speakerId);
  const answerMessageIds = sourceMessageIds(answerFragment, sourceKind);
  if (sourceKind !== "CONVERSATION" || !["user", "assistant"].includes(answerFragment.sourceRole)
    || !Number.isSafeInteger(ownerId) || !Number.isSafeInteger(speakerId) || speakerId <= 0 || speakerId === ownerId
    || !eligibleFragment(snapshot, answerFragment, sourceKind)
    || answerMessageIds.length !== 1 || !ids(answerFragment.presentIds).includes(ownerId)
    || !ids(answerFragment.presentIds).includes(speakerId)) return null;
  const answerMessageId = answerMessageIds[0];
  let latestPriorMessageId = -1;
  for (const fragment of snapshot.fragments || []) {
    if (!eligibleFragment(snapshot, fragment, sourceKind)) continue;
    for (const messageId of sourceMessageIds(fragment, sourceKind)) {
      if (messageId < answerMessageId && messageId > latestPriorMessageId) latestPriorMessageId = messageId;
    }
  }
  let question = null;
  for (const fragment of snapshot.fragments || []) {
    if (!eligibleFragment(snapshot, fragment, sourceKind) || !["user", "assistant"].includes(fragment.sourceRole)) continue;
    const questionMessageIds = sourceMessageIds(fragment, sourceKind);
    if (questionMessageIds.length === 1 && questionMessageIds[0] === latestPriorMessageId
      && questionMessageIds[0] < answerMessageId) {
      const questionSpeakerId = Number(fragment.speakerId);
      if (!ids(fragment.presentIds).includes(ownerId) || !ids(fragment.presentIds).includes(speakerId)
        || !ids(fragment.presentIds).includes(questionSpeakerId) || questionSpeakerId === speakerId
        || !ids(fragment.knownBy).includes(speakerId) || ageQuestionTarget(fragment, characters) !== speakerId) return null;
      question = fragment;
    }
  }
  if (question && [...(snapshot.withheldMessageIds || []), ...(snapshot.spokenMessageIds || [])].some(messageId =>
    Number.isSafeInteger(messageId) && messageId > latestPriorMessageId && messageId < answerMessageId)) return null;
  return question;
}

function scanSource(snapshot, gameData, sourceKind, letterProof = null) {
  assertScope(snapshot);
  if (!/^[a-f0-9]{64}$/.test(snapshot.sourceRevision || "") || !snapshot.date || !normalizeGameDate(snapshot.date)
    || gameData?.campaignToken !== snapshot.campaignToken) return { disclosures: [], skipped: "source_scope_or_date_invalid" };
  const characters = new Map(characterRows(gameData).map(character => [characterId(character), character]).filter(([id]) => id));
  if (!characters.size) return { disclosures: [], skipped: "disclosure_characters_missing" };
  const fragments = Array.isArray(snapshot.fragments) ? snapshot.fragments : [];
  const byFact = new Map();
  const diagnostics = new Map();
  for (const fragment of fragments) {
    if (!eligibleFragment(snapshot, fragment, sourceKind, letterProof)) continue;
    const sourceRole = sourceKind === "LETTER" ? "user" : fragment.sourceRole;
    if (!["user", "assistant"].includes(sourceRole)) continue;
    const ageQuestion = latestAgeQuestion(snapshot, fragment, sourceKind, characters);
    const directSpeech = sourceRole === "assistant"
      ? directSpeechSpans(fragment.text, characterAliases(characters.get(Number(fragment.speakerId))),
        { speakerId: fragment.speakerId, characters }) : [];
    const scanTexts = sourceRole === "assistant"
      ? [
        ...directSpeech.map(span => ({ text: span.text, speakerSelfOnly: false,
          ...(ageQuestion && parseBareCurrentAgeAnswer(span.text) !== null ? { ageQuestion } : {}) })),
        ...assistantSelfAssertions(fragment.text).map(text => ({ text, speakerSelfOnly: true }))
      ]
      : [{ text: fragment.text, speakerSelfOnly: false }];
    if (ageQuestion && parseBareCurrentAgeAnswer(fragment.text) !== null) {
      scanTexts.push({ text: fragment.text, speakerSelfOnly: true, ageQuestion });
    }
    for (const { text: scanText, speakerSelfOnly, ageQuestion: questionEvidence } of scanTexts) {
      const pieces = scanText.split(/([。.!！?？;；\r\n]+)/);
      for (let index = 0; index < pieces.length; index += 2) {
        const sentence = `${pieces[index] || ""}${pieces[index + 1] || ""}`.trim();
        if (!sentence || UNCERTAIN.test(sentence)) continue;
        // A speaker's own delivery cue is not somebody else's attributed claim.
        const attributedSpeech = [...sentence.matchAll(/说(?:道|过)?|告诉|提到|表示|宣称|转述|引用/g)].some(match => {
          const subject = sentence.slice(0, match.index).split(/[,，:：]/).at(-1).trim();
          return !subject || !/^(?:我|吾|朕|寡人|孤|本王|在下|鄙人|本人)?(?:低声|轻声|高声|大声|小声|悄声)?$/.test(subject);
        });
        if (attributedSpeech) continue;
        const targetAliasesById = matchedTargetAliases(sentence, characters, fragment);
        const bareAge = questionEvidence ? parseBareCurrentAgeAnswer(sentence.replace(/[。.!！?？;；]+$/u, "").trim()) : null;
        if (bareAge !== null) targetAliasesById.set(Number(fragment.speakerId), new Set(["我"]));
        for (const [entityId, targetAliases] of targetAliasesById) {
          if (speakerSelfOnly && entityId !== Number(fragment.speakerId)) continue;
          if (entityId === snapshot.ownerId) continue;
          const character = characters.get(entityId);
          const facts = getFactCandidates(character);
          const matched = new Set(matchedFacts(sentence, facts));
          const otherTargetAliases = uniqueText([...characters.values()].filter(candidate => characterId(candidate) !== entityId)
            .flatMap(characterAliases));
          for (const fact of facts) {
            if (questionEvidence && fact.factType !== "AGE") continue;
            const aliases = uniqueText([...targetAliases]);
            const ageAssertion = fact.factType === "AGE"
              ? isCurrentAgeAssertion(sentence.replace(/[。.!！?？;；]+$/u, "").trim(), aliases, fact, fragment)
                || entityId === Number(fragment.speakerId) && bareAge === Number(fact.value) : false;
            if (fact.factType === "AGE" ? !ageAssertion : !matched.has(fact.factKey)) continue;
            if (fact.factType !== "AGE") {
              const assertion = assertedBetween(sentence, aliases, fact.aliases, otherTargetAliases);
              if (!assertion.accepted) {
                if (assertion.reasonCode) {
                  const diagnostic = { code: assertion.reasonCode, ownerId: snapshot.ownerId, targetId: entityId, factKey: fact.factKey };
                  diagnostics.set(`${diagnostic.code}:${diagnostic.targetId}:${diagnostic.factKey}`, diagnostic);
                }
                continue;
              }
            }
            const factId = disclosureFactId(snapshot, entityId, fact.factType, fact.factKey);
            let disclosure = byFact.get(factId);
            if (!disclosure) {
              disclosure = { factId, entityId, factType: fact.factType, factKey: fact.factKey, value: fact.value, evidence: {
                sourceMessageIds: [], sourceFragmentIds: [], visibilityEvidence: [], sourceTextHashes: [] } };
              byFact.set(factId, disclosure);
            }
            const evidenceFragments = questionEvidence && entityId === Number(fragment.speakerId) && bareAge === Number(fact.value)
              ? [fragment, questionEvidence] : [fragment];
            for (const evidenceFragment of evidenceFragments) {
              disclosure.evidence.sourceMessageIds.push(...sourceMessageIds(evidenceFragment, sourceKind));
              disclosure.evidence.sourceFragmentIds.push(evidenceFragment.fragmentId);
              disclosure.evidence.visibilityEvidence.push(evidenceFragment.visibilityEvidence);
              disclosure.evidence.sourceTextHashes.push(hash(evidenceFragment.text));
            }
          }
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
  return { disclosures, skipped: null, ...(diagnostics.size ? { diagnostics: [...diagnostics.values()] } : {}) };
}

function scanVisibleDisclosures(snapshot, gameData) {
  if (snapshot?.sourceKind === "LETTER") return { disclosures: [], skipped: "letter_source_requires_delivery_gate" };
  if (snapshot?.sourceKind && snapshot.sourceKind !== "CONVERSATION") return { disclosures: [], skipped: "source_kind_invalid" };
  return scanSource(snapshot, gameData, "CONVERSATION");
}

module.exports = { getFactCandidates, disclosureFactId, isCurrentAgeAssertion, scanVisibleDisclosures, scanLetterDisclosures: scanSource };
