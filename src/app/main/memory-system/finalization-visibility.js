"use strict";

const { uniqueIds, VISIBILITIES, SOURCES } = require("./memory-types");
const { validateSummarySegmentPresenceBoundaries } = require("./perspective-projector");

const PRIVATE_CUE = /心想|心里|心底|心下|暗想|心中|内心|暗自|默念|没(?:有)?说出口|未说出口|腹诽|偷偷决定|无人察觉|趁人不注意|私下盘算|秘密决定/;
const GROUP_CUE = /只对.{0,16}(?:低声|说|讲|耳语)|(?:凑到|靠近).{0,16}耳边|私下告诉|悄声对|低声对/;
const PUBLIC_CUE = /公开(?:说|回应|表示|宣布)|(?:对|向|面向|转向)众人.{0,12}(?:说|回应|宣布|确认|提出)|(?:大声|朗声)(?:说|宣布)/;
const REPORTED_CUE = /听说|据说|声称|传闻|转述|告诉.{0,20}(?:已经|曾经|将要)/;
const PRESENCE_KINDS = new Set(["presence_join", "presence_leave", "presence_temporary_leave", "presence_temporary_return"]);

function speakerId(message, participants) {
  const direct = Number(message?.speakerCharacterId);
  if (Number.isSafeInteger(direct) && direct > 0) return direct;
  const matches = (participants || []).filter((person) => message?.name && [person.name, person.fullName, person.shortName].includes(message.name));
  return matches.length === 1 ? Number(matches[0].id) : null;
}

function presentIds(context, messageId) {
  return uniqueIds((context.participantPresence || []).filter((window) =>
    Number(window.joinedAtMessageId) <= messageId && (window.leftAtMessageId == null || messageId < Number(window.leftAtMessageId)))
    .map((window) => window.characterId));
}

function supportedGroup(source, participants, speaker, claimed) {
  const text = String(source.content || "");
  if (!GROUP_CUE.test(text) || !claimed.includes(speaker)) return [];
  const others = claimed.filter((id) => id !== speaker);
  if (others.length !== 1) return [];
  const target = participants.find((person) => Number(person.id) === others[0]);
  const names = [target?.name, target?.fullName, target?.shortName].filter((name) => typeof name === "string" && name.length >= 1);
  const cueAt = text.search(GROUP_CUE);
  return cueAt >= 0 && names.some((name) => text.slice(Math.max(0, cueAt - 20), cueAt + 24).includes(name)) ? claimed : [];
}

function isOutsideRestrictedParagraph(raw, content, cue) {
  const match = raw.match(cue);
  if (!match) return true;
  const excerpt = content.trim();
  if (raw.slice(0, match.index).includes(excerpt)) return true;
  return raw.split(/\r?\n/).some((paragraph) => !cue.test(paragraph) && paragraph.includes(excerpt));
}

function validateSourceItem(item, context, { segment = false } = {}) {
  const rawMessageIds = item?.provenance?.messageIds;
  if (!Array.isArray(rawMessageIds) || rawMessageIds.some((id, index) => !Number.isSafeInteger(id) || id < 0
    || (index > 0 && id <= rawMessageIds[index - 1]))) return { success: false, reason: "visibility_source_invalid" };
  const messageIds = uniqueIds(item?.provenance?.messageIds);
  const claimedSpeakers = uniqueIds(item?.provenance?.speakerIds);
  const claimedParticipants = uniqueIds(item?.participants);
  const visibility = item?.visibility;
  const participantSet = new Set(uniqueIds((context.participants || []).map((person) => person.id)));
  if (!messageIds.length || !messageIds.every((id) => Number.isSafeInteger(id) && id >= 0)
    || !claimedParticipants.length || claimedParticipants.some((id) => !participantSet.has(id))
    || !VISIBILITIES.has(visibility) || !SOURCES.has(item?.source))
    return { success: false, reason: "visibility_source_incomplete" };
  const sources = messageIds.map((id) => (context.messages || []).find((message) => Number(message.id) === id));
  if (sources.length === 1 && sources[0]?.role === "system" && PRESENCE_KINDS.has(sources[0].kind)) {
    const source = sources[0];
    const present = presentIds(context, Number(source.id));
    if (visibility !== "participants" || claimedSpeakers.length || String(item.content || "").trim() !== String(source.content || "").trim()
      || claimedParticipants.some((id) => !present.includes(id))) return { success: false, reason: "visibility_presence_marker_invalid" };
    return { success: true, audience: claimedParticipants, speakers: [], messageIds, visibility, source: "game_fact" };
  }
  if (!claimedSpeakers.length)
    return { success: false, reason: "visibility_source_incomplete" };
  if (sources.some((message) => !message || !["user", "assistant"].includes(message.role)))
    return { success: false, reason: "visibility_source_invalid" };
  const speakers = uniqueIds(sources.map((message) => speakerId(message, context.participants)));
  if (!speakers.length || speakers.some((id) => !participantSet.has(id) || !claimedSpeakers.includes(id)
    || !messageIds.every((messageId) => presentIds(context, messageId).includes(id)))
    || claimedSpeakers.some((id) => !speakers.includes(id)))
    return { success: false, reason: "visibility_speaker_unverified" };
  if (item.source === "game_fact") return { success: false, reason: "visibility_source_invalid" };
  if (claimedParticipants.some((id) => !messageIds.every((messageId) => presentIds(context, messageId).includes(id))))
    return { success: false, reason: "visibility_presence_invalid" };
  const content = String(item.content || "");
  if (!content.trim()) return { success: false, reason: "visibility_content_missing" };
  if (visibility !== "private" && PRIVATE_CUE.test(content))
    return { success: false, reason: "summary_segment_crosses_visibility_boundary" };
  if (!["private", "known_group"].includes(visibility) && GROUP_CUE.test(content))
    return { success: false, reason: "summary_segment_crosses_visibility_boundary" };
  if (visibility !== "private" && sources.some((source) =>
    !isOutsideRestrictedParagraph(String(source.content || ""), content, PRIVATE_CUE)))
    return { success: false, reason: "summary_segment_crosses_visibility_boundary" };
  if (!["private", "known_group"].includes(visibility) && sources.some((source) => {
    return !isOutsideRestrictedParagraph(String(source.content || ""), content, GROUP_CUE);
  })) return { success: false, reason: "summary_segment_crosses_visibility_boundary" };
  if (item.source === "witnessed" && sources.some((source) => REPORTED_CUE.test(String(source.content || ""))))
    return { success: false, reason: "visibility_reported_source_mismatch" };
  let audience = null;
  for (const source of sources) {
    const sourceSpeaker = speakerId(source, context.participants);
    const present = presentIds(context, Number(source.id));
    let allowed;
    if (visibility === "private") allowed = [sourceSpeaker];
    else if (visibility === "participants") allowed = claimedParticipants;
    else if (visibility === "known_group") allowed = supportedGroup(source, context.participants || [], sourceSpeaker, claimedParticipants);
    else allowed = present;
    allowed = uniqueIds(allowed).filter((id) => present.includes(id));
    audience = audience === null ? allowed : audience.filter((id) => allowed.includes(id));
  }
  if (!audience?.length) return { success: false, reason: "visibility_audience_unverified" };
  return { success: true, audience, speakers, messageIds, visibility, source: item.source || "spoken" };
}

function sourceParagraphSegments(context, source, restrictUnmarked = false) {
  const speaker = speakerId(source, context.participants);
  const present = presentIds(context, Number(source.id));
  const paragraphs = String(source.content || "").split(/\r?\n/).map((text) => text.trim()).filter(Boolean);
  if (!speaker || !present.includes(speaker) || !paragraphs.length) return null;
  return paragraphs.map((content) => {
    let visibility = "public";
    let participants = [speaker];
    if (PRIVATE_CUE.test(content)) visibility = "private";
    else if (GROUP_CUE.test(content)) {
      const targets = present.filter((id) => id !== speaker && supportedGroup({ content }, context.participants || [], speaker, [speaker, id]).length);
      if (targets.length === 1) { visibility = "known_group"; participants = [speaker, targets[0]]; }
      else visibility = "private";
    }
    else if (restrictUnmarked && !PUBLIC_CUE.test(content)) visibility = "private";
    return { content, participants, visibility, source: REPORTED_CUE.test(content) ? "reported" : "spoken",
      knownBy: [], provenance: { messageIds: [Number(source.id)], speakerIds: [speaker], extractionMode: "visibility_source_paragraph" } };
  });
}

function sourcePresenceSegment(context, source, restrictUnmarked = false) {
  if (source.role === "system" && PRESENCE_KINDS.has(source.kind)) return [{
    content: String(source.content || "").trim(), participants: presentIds(context, Number(source.id)),
    visibility: "participants", source: "game_fact", knownBy: [],
    provenance: { messageIds: [Number(source.id)], speakerIds: [], extractionMode: "visibility_source_presence" }
  }];
  return ["user", "assistant"].includes(source.role) ? sourceParagraphSegments(context, source, restrictUnmarked) : null;
}

function repairVisibilityBoundaries(context, extraction) {
  const repairedMessageIds = [];
  const segments = extraction.summarySegments || [];
  for (const segment of segments) {
    const validation = validateSourceItem(segment, context, { segment: true });
    const presence = validateSummarySegmentPresenceBoundaries(context, { summarySegments: [segment] });
    if (validation.success && presence.success) continue;
    const messageIds = uniqueIds(segment.provenance?.messageIds);
    if (!messageIds.length || messageIds.some((id) => !(context.messages || []).some((message) => Number(message.id) === id))) continue;
    if (messageIds.some((id) => !sourcePresenceSegment(context, (context.messages || []).find((message) => Number(message.id) === id)))) continue;
    for (const id of messageIds) if (!repairedMessageIds.includes(id)) repairedMessageIds.push(id);
  }
  // A replaced message can also occur in another segment. Rebuild that whole
  // source group so an overlapping segment cannot silently lose its other IDs.
  for (let index = 0; index < repairedMessageIds.length; index++) {
    for (const segment of segments) {
      const ids = uniqueIds(segment.provenance?.messageIds);
      if (!ids.includes(repairedMessageIds[index])) continue;
      for (const id of ids) {
        const source = (context.messages || []).find((message) => Number(message.id) === id);
        if (source && sourcePresenceSegment(context, source) && !repairedMessageIds.includes(id)) repairedMessageIds.push(id);
      }
    }
  }
  if (!repairedMessageIds.length) {
    extraction.memories = (extraction.memories || []).filter((memory) => validateSourceItem(memory, context).success);
    return { repairedMessageIds };
  }
  const repairs = new Map(repairedMessageIds.map((id) => {
    const source = (context.messages || []).find((message) => Number(message.id) === id);
    const restrictUnmarked = segments.some(segment => ["private", "known_group"].includes(segment.visibility)
      && uniqueIds(segment.provenance?.messageIds).includes(id));
    return [id, sourcePresenceSegment(context, source, restrictUnmarked)];
  }));
  const inserted = new Set();
  extraction.summarySegments = segments.flatMap((segment) => {
    const ids = uniqueIds(segment.provenance?.messageIds);
    if (!ids.length || !ids.every((id) => repairs.has(id))) return [segment];
    return ids.flatMap((id) => {
      if (!repairs.has(id) || inserted.has(id)) return [];
      inserted.add(id);
      return repairs.get(id);
    });
  });
  extraction.summarySegments.sort((left, right) =>
    Math.min(...(left.provenance?.messageIds || [])) - Math.min(...(right.provenance?.messageIds || [])));
  extraction.memories = (extraction.memories || []).filter((memory) =>
    !uniqueIds(memory.provenance?.messageIds).some((id) => repairs.has(id)) && validateSourceItem(memory, context).success);
  extraction.sessionSummary = extraction.summarySegments.map((segment) => segment.content).join("\n\n");
  return { repairedMessageIds };
}

function rebuildSourceNarrative(context, extraction = null) {
  const summarySegments = [];
  for (const source of context.messages || []) {
    if (!String(source.content || "").trim()) continue;
    if (source.role === "system" && !PRESENCE_KINDS.has(source.kind)) continue;
    const restrictUnmarked = (extraction?.summarySegments || []).some(segment => ["private", "known_group"].includes(segment.visibility)
      && uniqueIds(segment.provenance?.messageIds).includes(Number(source.id)));
    const segments = sourcePresenceSegment(context, source, restrictUnmarked);
    if (!segments || segments.some((segment) => !validateSourceItem(segment, context).success)) return null;
    summarySegments.push(...segments);
  }
  return summarySegments.length ? { structured: true, summarySegments, memories: [],
    sessionSummary: summarySegments.map((segment) => segment.content).join("\n\n") } : null;
}

function validateVisibilityBoundaries(context, extraction) {
  const failures = [];
  for (const [kind, items] of [["summarySegments", extraction.summarySegments || []], ["memories", extraction.memories || []]]) {
    for (const [index, item] of items.entries()) {
      const result = validateSourceItem(item, context, { segment: kind === "summarySegments" });
      if (!result.success) failures.push({ kind, index, reason: result.reason });
    }
  }
  return { success: failures.length === 0, failures, reasons: failures.map((failure) => failure.reason) };
}

module.exports = { validateSourceItem, validateVisibilityBoundaries, repairVisibilityBoundaries, rebuildSourceNarrative,
  presentIds, speakerId, sourceParagraphSegments };
