"use strict";

const { normalizeTraitKey, getTraitAliases } = require("../prompts/trait-visibility-policy");

const TITLE_RANKS = new Map([
  ["barony", { value: "男爵", aliases: ["Baron", "男爵领"] }],
  ["county", { value: "伯爵", aliases: ["Count", "County", "伯爵领"] }],
  ["duchy", { value: "公爵", aliases: ["Duke", "Duchy", "公爵领"] }],
  ["kingdom", { value: "国王", aliases: ["King", "Kingdom", "王国"] }],
  ["empire", { value: "皇帝", aliases: ["Emperor", "Empire", "帝国"] }]
]);

const KNOWN_SECRET_TRAITS = Object.freeze({
  secret_bastard: "bastard",
  secret_disputed_heritage: "disputed_heritage",
  secret_witch: "witch",
  secret_cannibal: "cannibal",
  secret_deviant: "deviant",
  secret_incest: "incestuous",
  secret_adulterer: "adulterer"
});

const UNCERTAIN = /[?？]|吗|么|可否|能否|是不是|是否|不是|并非|并不|未必|没有|从未|不曾|未曾|不再是|不属实|否认|听说|据说|传闻|传言|谣言|相传|声称|自称|据传|可能|也许|或许|似乎|疑似|假如|如果|要是|倘若|将来|未来|明年|后年|终将|迟早|尚未|未证实|曾经|曾是|曾为|曾任|当年|昔日|往日|过去|以前|原先|玩笑|虚构|误传|我猜|猜测|我想|以为|怀疑|认为|觉得|心想|暗想|心里|内心|心中|暗自|旁白|叙述|描写|\b(?:not|never|rumou?r|heard|alleged|claims?|said|might|may|perhaps|possibly|suppose|think|thought|thinking|believe|seem|if|whether|unless|will|would|future|intends?|intention|joking|fiction|unconfirmed|narration|aside)\b/i;
const DISCOURSE = /说|告诉|提到|声称|认为|觉得|怀疑|听说|据说|传闻|引用|否认|谣传/;
const FUTURE_MODAL = /(?:即将|将要|将会|将是|将为|将成为|将任|将担任|会成为|会是|会任|会担任|马上要|快要|准备|打算|计划|想要|要成为|\b(?:will|intend(?:s)?\s+to|plan(?:s)?\s+to|be\s+going\s+to|about\s+to)\b)/iu;
const FUTURE_TIME = /(?:明天|明日|后天|下月|下个月|来月|来年|以后|之后|届时|未来|将来)/iu;
const PREDICATES = /(?:(?:当前|如今|当今|现在|其实|确实|仍然|本来|向来|天生|生性|真正|正是|就是|确为|乃是|已(?:经)?成为|是|乃|为|系|拥有|具有|具备|患有|身患|有|很|非常|十分|极其|异常)|\b(?:am|is|are|has|have|possesses|born|very)\b|['’]s\b)/i;
const SPEAKER_SELF_ALIASES = ["我", "吾", "朕", "寡人", "孤", "本王", "在下", "鄙人", "本人", "i", "myself"];
const SELF_PRONOUN_PREFIX = /^(?:我|吾|朕|寡人|孤|本王|在下|鄙人|本人)\s*/u;
const SELF_ATTRIBUTE_HEAD = /^(?:即将|将要|将会|将是|将为|将成为|将任|将担任|会成为|会是|会任|会担任|以后会|之后会|届时会|未来会|马上要|快要|准备|打算|计划|想要|要|已(?:经)?(?:成为|是)|现在|如今|当前|目前|现任|现为|其实|确实|仍然|本来|向来|天生|生性|正是|就是|确为|乃是|乃|是|为|系|拥有|具有|具备|患有|身患|有|很|非常|十分|极其|异常)/u;
const SELF_LABELED_FACT_HEAD = /^(?:的)?(?:头衔|身份|职位|官职|特质|性格|特点|能力)\s*(?:(?:现在|如今|当前)\s*)?(?:是|为|乃|确为|就是|叫|名为)/u;
const ENGLISH_SELF_ASSERTION_HEAD = /^(?:i\s*(?:am|'m)|myself\s+(?:am|is|are|have|has|possess(?:es)?|born|very)\b)/i;
const RELATIONAL_FACT_SUFFIX = /^\s*(?:(?:的|之|地)\s*[\p{L}\p{N}_]|['’]s\s*[\p{L}\p{N}_])/iu;
const ACTION_NARRATION = /看着|看向|望着|注视|凝视|瞥向|转向|转过身|走向|走进|走出|来到|离开|行礼|鞠躬|拔出|拿起|举起|微笑|冷笑|皱眉|叹息|沉默|正在|开始|继续|thought|thinking|looked|watched|walked|turned|bowed|smiled|laughed|sighed|narration|stage direction/i;
const INNER_THOUGHT_OR_REPORT = /心想|心道|心知|心里|内心|暗自|想着|想起|想到|思忖|思量|琢磨|以为|觉得|认为|怀疑|听说|听闻|耳闻|闻说|听到|据说|传闻|传言|谣言|相传|旁白|叙述|描写|有人说|别人说|他人说|他说|她说|他们说|某人说|被告知|转述|引用|thought|thinking|believed|thought to|heard|rumou?r|report|according to|someone said|he said|she said/iu;
const WRITTEN_QUOTE = /写下|写道|写着|书写|记下|刻下|刻有|题写|纸上|纸条|字条|碑文|字迹|牌匾|\b(?:wrote|written|writes?|inscribed|inscription)\b/iu;
const REPORTED_SPEECH = /听[^。.!！?？;；，,\r\n]{0,24}(?:说(?:道|过)?|曰|道|表示|宣称|转述|闻|到)|耳闻|闻说/u;
const QUOTE_CLOSE = new Map([["“", "”"], ["‘", "’"], ["「", "」"], ["『", "』"], ['"', '"']]);
const QUOTE_CLOSERS = new Set(QUOTE_CLOSE.values());
const ATTRIBUTION_WORDS = /说(?:道|过)?|曰|道|表示|宣称|告诉|提到|问(?:道)?|答(?:道)?|回答|回应|追问|喊(?:道)?|笑|冷笑|看着|望着|行礼|thought|said|asked|told|declared|remarked|looked|bowed/i;

function normalizedText(value) {
  return typeof value === "string" ? value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ") : "";
}

function uniqueText(values) {
  return [...new Set(values.map(normalizedText).filter(Boolean))];
}

function cleanString(value) {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]*>/g, "").trim();
}

function titleFactKey(value) {
  return `title_${normalizedText(value).replace(/\s+/g, "_")}`;
}

function nameFactKey(value) {
  return `name_${normalizedText(value).replace(/\s+/g, "_")}`;
}

function nicknameFactKey(value) {
  return `nickname_${normalizedText(value).replace(/\s+/g, "_")}`;
}

function normalizeCandidate(candidate) {
  if (!candidate || !["TITLE", "TRAIT", "NAME", "NICKNAME"].includes(candidate.factType)) return null;
  const value = cleanString(candidate.value || candidate.name || candidate.localizedName);
  if (!value || ["TITLE", "NICKNAME"].includes(candidate.factType)
    && /^(?:none(?:\s|$)|concept_none|无|无主要头衔)$/i.test(value)) return null;
  const canonicalKey = candidate.factType === "TITLE" || candidate.factType === "NAME" || candidate.factType === "NICKNAME"
    ? normalizedText(value)
    : normalizeTraitKey({ traitId: candidate.canonicalKey || candidate.traitId || candidate.key || candidate.id, name: value });
  const factKey = candidate.factType === "TITLE" ? titleFactKey(value)
    : candidate.factType === "TRAIT" ? `trait_${canonicalKey}`
      : candidate.factType === "NAME" ? nameFactKey(value) : nicknameFactKey(value);
  if (!canonicalKey || candidate.factKey && candidate.factKey !== factKey) return null;
  const traitAliases = candidate.factType === "TRAIT" ? getTraitAliases({ traitId: canonicalKey, name: value,
    localizedName: candidate.localizedName, key: candidate.key, id: candidate.id }) : [];
  return { factType: candidate.factType, factKey, canonicalKey, value,
    aliases: uniqueText(candidate.factType === "NAME" || candidate.factType === "NICKNAME"
      ? [value, ...(Array.isArray(candidate.aliases) ? candidate.aliases : [])]
      : [value, candidate.canonicalKey, candidate.traitId, candidate.key, candidate.id,
        candidate.localizedName, ...traitAliases, ...(Array.isArray(candidate.aliases) ? candidate.aliases : [])]),
    ...(candidate.factType === "TRAIT" && typeof candidate.category === "string" ? { category: candidate.category } : {}) };
}

function nameValues(character) {
  const values = [
    ...(Array.isArray(character?.names) ? character.names : []),
    character?.fullName, character?.name, character?.firstName, character?.shortName
  ].map(value => typeof value === "object" && value
    ? value.name || value.value || value.localizedName : value);
  return [...new Map(values.map(cleanString).filter(value => value && !/^none(?:\s|$)/i.test(value)
    && !/^concept_/i.test(value)).map(value => [normalizedText(value), value])).values()];
}

function getDisclosureFactCandidates(character) {
  if (!character || typeof character !== "object") return [];
  const candidates = [];
  if (Array.isArray(character.facts)) {
    for (const row of character.facts) {
      const candidate = normalizeCandidate(row);
      if (candidate) candidates.push(candidate);
    }
  }
  const addTitle = (value, aliases = []) => {
    const title = typeof value === "string" ? value : value?.value || value?.name || value?.localizedName;
    const candidate = normalizeCandidate({ factType: "TITLE", value: title,
      aliases: [...(Array.isArray(value?.aliases) ? value.aliases : []), ...aliases] });
    if (candidate) candidates.push(candidate);
  };
  addTitle(character.primaryTitle);
  const rankText = normalizedText(character.titleRankConcept).replace(/^concept_|^title_rank_/, "");
  const rank = TITLE_RANKS.get(rankText);
  if (rank) addTitle(rank.value, [...rank.aliases, character.titleRankConcept]);
  const positions = Array.isArray(character.heldCourtAndCouncilPositions)
    ? character.heldCourtAndCouncilPositions
    : String(character.heldCourtAndCouncilPositions || "").split(/[,，、;；\n|]/);
  for (const position of positions) addTitle(position);
  for (const title of [...(Array.isArray(character.titles) ? character.titles : []),
    ...(Array.isArray(character.titleCandidates) ? character.titleCandidates : [])]) addTitle(title);
  if (!Array.isArray(character.facts)) {
    for (const trait of Array.isArray(character.traits) ? character.traits : []) {
      const value = typeof trait === "string" ? trait : trait?.localizedName || trait?.name || trait?.value;
      const candidate = normalizeCandidate({ factType: "TRAIT", value,
        canonicalKey: typeof trait === "object" ? trait.traitId || trait.key || trait.id : null,
        category: trait?.category,
        aliases: [...getTraitAliases(trait), ...(typeof trait === "object"
          ? [trait.shortName, trait.alias, ...(Array.isArray(trait.aliases) ? trait.aliases : [])] : [])] });
      if (candidate) candidates.push(candidate);
    }
  }

  for (const value of nameValues(character)) {
    const candidate = normalizeCandidate({ factType: "NAME", value });
    if (candidate) candidates.push(candidate);
  }
  const nickname = cleanString(character.nickname);
  const nicknameCandidate = normalizeCandidate({ factType: "NICKNAME", value: nickname });
  if (nicknameCandidate) candidates.push(nicknameCandidate);

  const byKey = new Map();
  for (const candidate of candidates) {
    const identity = `${candidate.factType}:${candidate.factKey}`;
    const previous = byKey.get(identity);
    if (!previous) byKey.set(identity, { ...candidate, aliases: [...candidate.aliases] });
    else previous.aliases = uniqueText([...previous.aliases, ...candidate.aliases]);
  }
  return [...byKey.values()].sort((left, right) => left.factType.localeCompare(right.factType)
    || left.factKey.localeCompare(right.factKey));
}

function runtimeId(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,20}$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function readCharacter(gameData, id) {
  const characters = gameData?.characters;
  if (characters instanceof Map) {
    const character = characters.get(id) || characters.get(String(id)) || null;
    return runtimeId(character?.id) === id ? character : null;
  }
  if (!characters || typeof characters !== "object" || Array.isArray(characters)
    || !Object.prototype.hasOwnProperty.call(characters, String(id))) return null;
  const character = characters[String(id)];
  return runtimeId(character?.id) === id ? character : null;
}

function identityAliases(character) {
  return uniqueText([
    ...(Array.isArray(character?.names) ? character.names : []), character?.fullName,
    character?.shortName, character?.firstName, character?.name, character?.nickname
  ].map(value => typeof value === "object" && value ? value.name || value.value || value.localizedName : value));
}

function occurrences(text, alias) {
  const found = [];
  let start = 0;
  while ((start = text.indexOf(alias, start)) >= 0) {
    const end = start + alias.length;
    if (!/^[a-z0-9 ]+$/i.test(alias)
      || (!/[\p{L}\p{N}_-]/u.test(text[start - 1] || "") && !/[\p{L}\p{N}_-]/u.test(text[end] || ""))) {
      found.push({ start, end, alias });
    }
    start = end;
  }
  return found;
}

function longestOccurrences(items) {
  return items.filter(item => !items.some(other => other.start <= item.start && other.end >= item.end
    && other.end - other.start > item.end - item.start));
}

function matchedTargetAliases(text, profiles, speakerId) {
  const aliasOwners = new Map();
  for (const [id, row] of profiles) for (const alias of identityAliases(row.character)) {
    if (!aliasOwners.has(alias)) aliasOwners.set(alias, new Set());
    aliasOwners.get(alias).add(id);
  }
  const occurrencesById = [];
  for (const [alias, owners] of aliasOwners) {
    if (owners.size !== 1) continue;
    const id = [...owners][0];
    for (const occurrence of occurrences(text, alias)) occurrencesById.push({ ...occurrence, id });
  }
  const longest = longestOccurrences(occurrencesById);
  const spans = new Map();
  for (const row of longest) {
    const key = `${row.start}:${row.end}`;
    if (!spans.has(key)) spans.set(key, new Set());
    spans.get(key).add(row.id);
  }
  const aliasesById = new Map();
  for (const row of longest.filter(item => spans.get(`${item.start}:${item.end}`)?.size === 1)) {
    if (!aliasesById.has(row.id)) aliasesById.set(row.id, new Set());
    aliasesById.get(row.id).add(row.alias);
  }
  for (const alias of SPEAKER_SELF_ALIASES) {
    if (occurrences(text, alias).length) {
      if (!aliasesById.has(speakerId)) aliasesById.set(speakerId, new Set());
      aliasesById.get(speakerId).add(alias);
    }
  }
  return aliasesById;
}

function matchedFacts(text, facts) {
  const matches = [];
  for (const fact of facts) for (const alias of fact.aliases) {
    for (const occurrence of occurrences(text, alias)) matches.push({ ...occurrence, factId: `${fact.factType}:${fact.factKey}` });
  }
  const longest = longestOccurrences(matches);
  const spans = new Map();
  for (const row of longest) {
    const key = `${row.start}:${row.end}`;
    if (!spans.has(key)) spans.set(key, new Set());
    spans.get(key).add(row.factId);
  }
  return new Set(longest.filter(row => spans.get(`${row.start}:${row.end}`)?.size === 1).map(row => row.factId));
}

function assertedBetween(text, targetAliases, factAliases, otherTargetAliases = []) {
  for (const targetAlias of targetAliases) for (const target of occurrences(text, targetAlias)) {
    for (const factAlias of factAliases) for (const fact of occurrences(text, factAlias)) {
      if (fact.start < target.end || fact.start - target.end > 40) continue;
      const suffix = text.slice(fact.end);
      if (/^\s*地\s*[\p{L}\p{N}_]/iu.test(suffix) || RELATIONAL_FACT_SUFFIX.test(suffix)) continue;
      const between = text.slice(target.end, fact.start);
      if (otherTargetAliases.some(alias => occurrences(between, alias).length) || DISCOURSE.test(between)
        || /不|未|没|非|无/.test(between)) continue;
      if (FUTURE_MODAL.test(text) || FUTURE_TIME.test(text)) continue;
      if (PREDICATES.test(between)) return true;
    }
  }
  return false;
}

function explicitSelfAssertion(text) {
  const selfPrefix = text.match(SELF_PRONOUN_PREFIX);
  if (selfPrefix && (SELF_ATTRIBUTE_HEAD.test(text.slice(selfPrefix[0].length))
    || SELF_LABELED_FACT_HEAD.test(text.slice(selfPrefix[0].length)))) return true;
  return ENGLISH_SELF_ASSERTION_HEAD.test(text);
}

function aliasesForFact(fact) {
  return uniqueText([fact.value, ...(Array.isArray(fact.aliases) ? fact.aliases : [])]);
}

function phraseRemainderMatches(remainder, facts) {
  const text = normalizedText(remainder).replace(/[。.!！?？;；]+$/u, "").trim();
  const matches = [];
  for (const fact of facts) for (const alias of aliasesForFact(fact)) {
    if (!alias || !text.startsWith(alias)) continue;
    const suffix = text.slice(alias.length).trim();
    if (suffix && !/^(?:啊|呀|呢|了|也|而已)$/u.test(suffix)) continue;
    matches.push({ fact, alias });
  }
  const longest = matches.filter(row => !matches.some(other => other.alias.length > row.alias.length && other.alias.startsWith(row.alias)));
  const factKeys = new Set(longest.map(row => `${row.fact.factType}:${row.fact.factKey}`));
  return factKeys.size === 1 ? longest[0].fact : null;
}

function explicitNameTarget(sentence, profiles, speakerId) {
  const selfPrefixes = [
    /^(?:我|吾|朕|寡人|孤|本王|在下|鄙人|本人)\s*(?:的)?(?:名字|姓名|名讳|名號|名号)\s*(?:现在|如今|当前)?\s*(?:是|叫|名为|叫做)\s*/u,
    /^(?:我|吾|朕|寡人|孤|本王|在下|鄙人|本人)\s*(?:名叫|叫做|叫|名为)\s*/u,
    /^(?:我|吾|朕|寡人|孤|本王|在下|鄙人|本人)\s*(?:名为|名叫)\s*/u,
    /^(?:我是|吾是|朕是|在下是|鄙人是|本人是)\s*/u,
    /^吾乃\s*/u,
    /^臣名(?:为|為|叫)?\s*/u,
    /^(?:在下|鄙人|本人)\s*/u,
    /^(?:吾名|我名)\s*(?:为|叫)?\s*/u,
    /^my\s+name\s+is\s+/i,
    /^(?:i\s+am|i'm)\s+/i
  ];
  const normalized = sentence.normalize("NFKC").trim();
  for (const prefix of selfPrefixes) {
    const match = normalized.match(prefix);
    if (!match) continue;
    const fact = phraseRemainderMatches(normalized.slice(match[0].length), profiles.get(speakerId)?.facts.filter(row => row.factType === "NAME") || []);
    if (fact) return { targetId: speakerId, fact };
  }

  const target = resolveLeadingTarget(normalized, profiles);
  if (!target) return null;
  const match = target.remainder.match(/^(?:的)?(?:名字|姓名|名讳|名號|名号)?\s*(?:是|叫|名为|叫做|名叫)\s*/u);
  if (!match || !match[0].trim()) return null;
  const fact = phraseRemainderMatches(target.remainder.slice(match[0].length),
    profiles.get(target.targetId)?.facts.filter(row => row.factType === "NAME") || []);
  return fact ? { targetId: target.targetId, fact } : null;
}

function resolveLeadingTarget(text, profiles) {
  const matches = [];
  for (const [targetId, profile] of profiles) for (const alias of identityAliases(profile.character)) {
    if (text.startsWith(alias)) matches.push({ targetId, alias });
  }
  if (!matches.length) return null;
  const longest = Math.max(...matches.map(row => row.alias.length));
  const selected = matches.filter(row => row.alias.length === longest);
  const targetIds = [...new Set(selected.map(row => row.targetId))];
  return targetIds.length === 1 ? { targetId: targetIds[0], alias: selected[0].alias,
    remainder: text.slice(longest) } : null;
}

function explicitNicknameTarget(sentence, profiles, speakerId) {
  const selfPrefixes = [
    /^(?:我|吾|朕|寡人|孤|本王|在下|鄙人|本人)\s*(?:的)?(?:称号|綽號|绰号|昵称|外号|外號|别名)\s*(?:现在|如今|当前)?\s*(?:是|为|叫|名为|叫做)\s*/u,
    /^(?:人称|人稱|大家称我|大家稱我|世人称我|世人稱我|众人称我|眾人稱我)(?:呼)?我?(?:为|為|作|做)?\s*/u,
    /^my\s+(?:nickname|epithet|moniker|sobriquet)\s+is\s+/i,
    /^(?:they|people)\s+call\s+me\s+/i,
    /^i\s+am\s+known\s+as\s+/i
  ];
  const normalized = sentence.normalize("NFKC").trim();
  for (const prefix of selfPrefixes) {
    const match = normalized.match(prefix);
    if (!match) continue;
    const fact = phraseRemainderMatches(normalized.slice(match[0].length),
      profiles.get(speakerId)?.facts.filter(row => row.factType === "NICKNAME") || []);
    if (fact) return { targetId: speakerId, fact };
  }

  const target = resolveLeadingTarget(normalized, profiles);
  if (!target) return null;
  const match = target.remainder.match(/^(?:的)?(?:称号|稱號|绰号|綽號|昵称|外号|外號|别名)\s*(?:现在|如今|当前)?\s*(?:是|为|叫|名为|叫做)\s*/u);
  if (!match) return null;
  const fact = phraseRemainderMatches(target.remainder.slice(match[0].length),
    profiles.get(target.targetId)?.facts.filter(row => row.factType === "NICKNAME") || []);
  return fact ? { targetId: target.targetId, fact } : null;
}

function explicitIntroductionTitleTarget(sentence, profiles, speakerId) {
  const normalized = sentence.normalize("NFKC").trim();
  const prefix = normalized.match(/^(?:(?:现任|现为)\s*(?:(?:头衔|官职|职位|身份)\s*)?(?:是|为|乃|任)?|(?:如今|现在|当前|目前)\s*(?:(?:头衔|官职|职位|身份)\s*)?(?:是|为|乃|任))\s*/u);
  if (!prefix || !prefix[0].trim()) return null;
  const fact = phraseRemainderMatches(normalized.slice(prefix[0].length),
    profiles.get(speakerId)?.facts.filter(row => row.factType === "TITLE") || []);
  return fact ? { targetId: speakerId, fact } : null;
}

function splitExplicitIdentityClauses(sentence) {
  const parts = sentence.split(/([,，;；])/u);
  const clauses = [];
  let prefix = "";
  for (let index = 0; index < parts.length; index += 2) {
    const clause = (parts[index] || "").trim();
    if (clause) clauses.push({ clause, prefix });
    prefix += `${parts[index] || ""}${parts[index + 1] || ""}`;
  }
  return clauses;
}

function hasReportedIntroductionPrefix(prefix) {
  return UNCERTAIN.test(prefix) || DISCOURSE.test(prefix) || INNER_THOUGHT_OR_REPORT.test(prefix)
    || WRITTEN_QUOTE.test(prefix) || REPORTED_SPEECH.test(prefix) || ATTRIBUTION_WORDS.test(prefix);
}

function explicitIdentityIntroductionAssertions(sentence, profiles, speakerId) {
  const assertions = [];
  let selfIdentityIntroduced = false;
  for (const { clause, prefix } of splitExplicitIdentityClauses(sentence)) {
    if (!UNCERTAIN.test(clause) && !DISCOURSE.test(clause) && !hasReportedIntroductionPrefix(prefix)) {
      const name = explicitNameTarget(clause, profiles, speakerId);
      const nickname = explicitNicknameTarget(clause, profiles, speakerId);
      if (name) {
        assertions.push(name);
        if (name.targetId === speakerId) selfIdentityIntroduced = true;
      }
      if (nickname) {
        assertions.push(nickname);
        if (nickname.targetId === speakerId) selfIdentityIntroduced = true;
      }
      if (selfIdentityIntroduced) {
        const title = explicitIntroductionTitleTarget(clause, profiles, speakerId);
        if (title) assertions.push(title);
      }
    }
  }
  return assertions;
}

function sourceIdentity(source, gameData) {
  if (!source || typeof source !== "object") return null;
  const conversationId = typeof source.conversationId === "string" ? source.conversationId.trim() : "";
  if (source.messageId === null || source.messageId === undefined || !/^\d+$/.test(String(source.messageId).trim())) return null;
  const messageId = Number(source.messageId);
  const messageRevision = String(source.messageRevision || source.revision || "").trim().toLowerCase();
  const campaignToken = typeof source.campaignToken === "string" ? source.campaignToken.trim() : "";
  const gameDate = typeof source.gameDate === "string" ? source.gameDate.trim() : "";
  if (!conversationId || !Number.isSafeInteger(messageId) || messageId < 0
    || !/^[a-f0-9]{64}$/.test(messageRevision) || !campaignToken || !gameDate
    || campaignToken !== gameData?.campaignToken || gameDate !== gameData?.date) return null;
  return { conversationId, messageId, messageRevision, campaignToken, gameDate };
}

function knownFactMatches(knownFacts, speakerId, targetId, candidate) {
  if (!Array.isArray(knownFacts)) return false;
  return knownFacts.some(row => {
    if (!row || typeof row !== "object") return false;
    const ownerId = runtimeId(row.ownerRuntimeId ?? row.ownerId);
    const factTargetId = runtimeId(row.targetRuntimeId ?? row.targetId ?? row.entityId);
    if (ownerId !== speakerId || factTargetId !== targetId || row.factType !== candidate.factType
      || row.factKey !== candidate.factKey) return false;
    if (row.effectiveKnown === false || row.known === false || row.knownToOwner === false || row.current === false) return false;
    const status = String(row.status || "").toUpperCase();
    if (["MANUAL_HIDDEN", "HIDDEN", "FORGOTTEN", "REVOKED", "UNKNOWN", "BLOCKED"].includes(status)) return false;
    return true;
  });
}

function knownSecretMatches(speaker, targetId, candidate) {
  if (candidate.factType !== "TRAIT" || !Array.isArray(speaker?.knownSecrets)) return false;
  const canonicalTrait = KNOWN_SECRET_TRAITS;
  return speaker.knownSecrets.some(secret => String(secret?.ownerId ?? "") === String(targetId)
    && canonicalTrait[String(secret?.type || "").toLowerCase()] === candidate.canonicalKey);
}

function splitSentences(text) {
  const pieces = text.split(/([。.!！?？;；\r\n]+)/u);
  const sentences = [];
  for (let index = 0; index < pieces.length; index += 2) {
    const sentence = normalizedText(`${pieces[index] || ""}${pieces[index + 1] || ""}`);
    if (sentence) sentences.push(sentence);
  }
  return sentences;
}

function clauseAliasResolution(clause, profiles, speakerId) {
  const normalized = normalizedText(clause);
  const matches = [];
  for (const [id, profile] of profiles) for (const alias of identityAliases(profile.character)) {
    if (normalized.startsWith(alias)) matches.push({ id, alias });
  }
  if (!matches.length) return { kind: "none" };
  const longest = Math.max(...matches.map(row => row.alias.length));
  const rows = matches.filter(row => row.alias.length === longest);
  const ids = [...new Set(rows.map(row => row.id))];
  const suffix = normalized.slice(longest).trimStart();
  if (ids.length !== 1 || /^(?:的|之|和|与|同|及|跟|并|以及|一同|共同|二人|两人|、|手下|属下|部下|麾下|帐下|幕下|门下|身边|身侧|身旁|随从|侍从|家臣)/u.test(suffix)) {
    return { kind: "ambiguous" };
  }
  return { kind: ids[0] === speakerId ? "self" : "other" };
}

function recipientDirectedSpeechClause(clause, profiles) {
  const normalized = normalizedText(clause).replace(/[：:,，]+$/u, "").trim();
  const prefix = normalized.match(/^(?:(?:只|仅)\s*)?对/u);
  if (!prefix) return null;
  const remainder = normalized.slice(prefix[0].length);
  const matches = [];
  for (const [id, profile] of profiles) for (const alias of identityAliases(profile.character)) {
    if (!remainder.startsWith(alias)) continue;
    const suffix = remainder.slice(alias.length);
    const speech = suffix.match(/^(?:(?:低声|轻声|悄声|小声|耳语|私下|秘密地|悄悄地|轻轻地|whisper(?:ing)?|quietly)\s*)?(?:说(?:道|过)?|道|曰|表示|宣称|问(?:道)?|答(?:道)?|回答|回应|喊(?:道)?)\s*$/iu);
    if (!speech) continue;
    matches.push({ id, alias, exclusive: /^(?:(?:只|仅)\s*)?对/u.test(normalized)
      && (/^(?:只|仅)\s*对/u.test(normalized) || /低声|轻声|悄声|小声|耳语|私下|秘密|悄悄|轻轻|whisper|quietly/iu.test(suffix)) });
  }
  if (!matches.length) return null;
  const longest = Math.max(...matches.map(row => row.alias.length));
  const selected = matches.filter(row => row.alias.length === longest);
  const targetIds = [...new Set(selected.map(row => row.id))];
  if (targetIds.length !== 1) return null;
  return { recipientRuntimeId: targetIds[0], exclusive: selected.some(row => row.exclusive) };
}

function quoteContextIsSpeakerSpeech(text, start, end, profiles, speakerId, audienceIds) {
  const prefix = text.slice(0, start - 1);
  const boundaries = [...prefix.matchAll(/[。.!！?？;；\r\n]|[”’」』"]/gu)];
  const boundary = boundaries.at(-1);
  const context = prefix.slice(boundary ? boundary.index + 1 : 0).trim();
  const after = text.slice(end + 1);
  const nextSentenceBoundary = after.search(/[。.!！?？;；\r\n]/u);
  const nextQuote = after.search(/[“‘「『"]/u);
  const trailing = after.slice(0, nextQuote >= 0 && (nextSentenceBoundary < 0 || nextQuote < nextSentenceBoundary)
    ? nextQuote : nextSentenceBoundary < 0 ? after.length : nextSentenceBoundary).replace(/^[\s，,:：、—–-]+/u, "").trim();
  if ([context, trailing].some(clause => INNER_THOUGHT_OR_REPORT.test(clause) || WRITTEN_QUOTE.test(clause)
    || REPORTED_SPEECH.test(clause))) return false;
  const clauses = [context.split(/[,，]|[—–]+/u).filter(Boolean).at(-1) || "", trailing];
  const resolutions = clauses.map(clause => clauseAliasResolution(clause, profiles, speakerId));
  if (resolutions.some(row => row.kind === "other" || row.kind === "ambiguous")) return false;
  const recipientClauses = [context, trailing].map(clause => recipientDirectedSpeechClause(clause, profiles)).filter(Boolean);
  if (recipientClauses.length) {
    const recipientIds = [...new Set(recipientClauses.map(row => row.recipientRuntimeId))];
    if (recipientIds.length !== 1 || !audienceIds.includes(recipientIds[0])) return false;
    const exclusive = recipientClauses.some(row => row.exclusive);
    return { accepted: true, recipientIds: exclusive ? recipientIds : audienceIds };
  }
  if (resolutions.some(row => row.kind === "self")) return { accepted: true, recipientIds: audienceIds };
  if (clauses.some(clause => ATTRIBUTION_WORDS.test(clause))) return false;
  return { accepted: true, recipientIds: audienceIds };
}

function spokenTexts(text, profiles, speakerId, audienceIds) {
  if (typeof text !== "string" || !text.trim()) return [];
  const spans = [];
  const stack = [];
  let sawQuote = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (stack.length) {
      const active = stack[stack.length - 1];
      if (character === active.close) {
        stack.pop();
        if (!stack.length) {
          const start = active.start + 1;
          const end = index;
          if (!active.nested && text.slice(start, end).trim()) {
            const context = quoteContextIsSpeakerSpeech(text, active.start + 1, end, profiles, speakerId, audienceIds);
            if (context?.accepted) spans.push({ text: text.slice(start, end), recipientIds: context.recipientIds });
          }
        }
        continue;
      }
      if (QUOTE_CLOSE.has(character)) {
        for (const frame of stack) frame.nested = true;
        stack.push({ start: index, close: QUOTE_CLOSE.get(character), nested: true });
        continue;
      }
      if (QUOTE_CLOSERS.has(character)) return [];
      continue;
    }
    if (QUOTE_CLOSE.has(character)) {
      sawQuote = true;
      stack.push({ start: index, close: QUOTE_CLOSE.get(character), nested: false });
      continue;
    }
    if (QUOTE_CLOSERS.has(character)) return [];
  }
  if (stack.length) return [];
  if (sawQuote) return spans;
  if (ACTION_NARRATION.test(text) || WRITTEN_QUOTE.test(text)) return [];
  return [{ text, recipientIds: audienceIds }];
}

function extractCharacterDisclosures({ gameData, speakerId: speakerValue, text, audienceIds = [], candidateTargetIds = [],
  knownFacts = [], source } = {}) {
  const speakerId = runtimeId(speakerValue);
  const identity = sourceIdentity(source, gameData);
  const speakersCharacter = speakerId ? readCharacter(gameData, speakerId) : null;
  if (!speakerId || !identity || !speakersCharacter || typeof text !== "string" || !text.trim()) return { disclosures: [] };

  const targetIds = [...new Set([speakerId, ...(Array.isArray(candidateTargetIds) ? candidateTargetIds.map(runtimeId) : [])]
    .filter(id => id !== null))].sort((left, right) => left - right);
  const profiles = new Map();
  for (const targetId of targetIds) {
    const character = readCharacter(gameData, targetId);
    if (character) profiles.set(targetId, { character, facts: getDisclosureFactCandidates(character) });
  }
  if (!profiles.has(speakerId)) return { disclosures: [] };
  const audience = [...new Set((Array.isArray(audienceIds) ? audienceIds : []).map(runtimeId)
    .filter(id => id !== null && id !== speakerId))].sort((left, right) => left - right);
  if (!audience.length) return { disclosures: [] };

  const frozenAudience = [...new Set((Array.isArray(audienceIds) ? audienceIds : []).map(runtimeId)
    .filter(id => id !== null))].sort((left, right) => left - right);
  const collected = new Map();
  const record = (targetId, candidate, recipientIds) => {
    if (targetId !== speakerId && !knownFactMatches(knownFacts, speakerId, targetId, candidate)
      && !knownSecretMatches(speakersCharacter, targetId, candidate)) return;
    for (const ownerRuntimeId of recipientIds.filter(id => audience.includes(id))) {
      if (ownerRuntimeId === targetId) continue;
      const row = { ownerRuntimeId, targetRuntimeId: targetId, factType: candidate.factType,
        factKey: candidate.factKey, value: candidate.value, aliases: [...candidate.aliases],
        sourceIdentity: { ...identity, speakerRuntimeId: speakerId } };
      collected.set(`${ownerRuntimeId}:${targetId}:${candidate.factType}:${candidate.factKey}`, row);
    }
  };

  const allOtherTargetAliases = uniqueText([...profiles.entries()].flatMap(([id, profile]) => id === speakerId
    ? [] : identityAliases(profile.character)));
  for (const spokenText of spokenTexts(text, profiles, speakerId, frozenAudience)) {
    for (const sentence of splitSentences(spokenText.text)) {
      for (const assertion of explicitIdentityIntroductionAssertions(sentence, profiles, speakerId))
        record(assertion.targetId, assertion.fact, spokenText.recipientIds);
      if (UNCERTAIN.test(sentence) || DISCOURSE.test(sentence) || INNER_THOUGHT_OR_REPORT.test(sentence)
        || WRITTEN_QUOTE.test(sentence) || ACTION_NARRATION.test(sentence)) continue;

      const targets = matchedTargetAliases(sentence, profiles, speakerId);
      const matchedFactKeysById = new Map();
      for (const [targetId, profile] of profiles) {
        const matched = matchedFacts(sentence, profile.facts.filter(candidate => !["NAME", "NICKNAME"].includes(candidate.factType)));
        matchedFactKeysById.set(targetId, matched);
      }
      for (const [targetId, aliases] of targets) {
        const profile = profiles.get(targetId);
        if (!profile) continue;
        if (targetId === speakerId && !explicitSelfAssertion(sentence)) continue;
        for (const candidate of profile.facts) {
          if (["NAME", "NICKNAME"].includes(candidate.factType)
            || !matchedFactKeysById.get(targetId)?.has(`${candidate.factType}:${candidate.factKey}`)) continue;
          if (!assertedBetween(sentence, [...aliases], aliasesForFact(candidate), allOtherTargetAliases)) continue;
          record(targetId, candidate, spokenText.recipientIds);
        }
      }
    }
  }
  return { disclosures: [...collected.values()].sort((left, right) => left.ownerRuntimeId - right.ownerRuntimeId
    || left.targetRuntimeId - right.targetRuntimeId || left.factType.localeCompare(right.factType)
    || left.factKey.localeCompare(right.factKey)) };
}

module.exports = { getDisclosureFactCandidates, extractCharacterDisclosures };
