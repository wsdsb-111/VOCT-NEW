"use strict";

const { createMemoryRecord } = require("./memory-types");

class MemoryExtractor {
  buildPrompt({ messages, participants, participantPresence = [], date, totalDays, rollingSummary = "", finalInstructions = "" } = {}) {
    const participantText = (participants || []).map((entry) => {
      const details = [`姓名=${entry.name || entry.fullName || "未知"}`];
      if (entry.fullName && entry.fullName !== entry.name) details.push(`游戏称号=${entry.fullName}`);
      if (entry.primaryTitle) details.push(`头衔=${entry.primaryTitle}`);
      return `${entry.id}: ${details.join("；")}`;
    }).join("\n");
    const presenceText = participantPresence.map((window) => `${window.characterId}: joinedAt=${window.joinedAtMessageId ?? "unknown"}; leftBefore=${window.leftAtMessageId ?? "conversation_end"}`).join("\n");
    const conversationText = (messages || []).map((entry) => `[messageId=${entry.id}${entry.kind ? `; kind=${entry.kind}` : ""}] ${entry.name || entry.role}: ${entry.content}`).join("\n");
    return [
      {
        role: "system",
        content: `VOTC Memory Engine 2.3 structured extraction. Return one JSON object only; never put analysis or reasoning inside the JSON. Do not decide who knows a memory; knowledge is computed locally. Distinguish facts, beliefs, plans and rumors. Split memories when different people are the subject. participants are the people who acted in or directly took part in that event; subjects are only the people directly described by that memory. Do not copy every scene participant into subjects. Respect the supplied half-open presence windows: a character can participate in or hear message M only when joinedAt <= M.id < leftBefore. Never include a waiting character before joinedAt or a departed character at/after leftBefore. Always provide the exact supporting messageIds.

Put the complete detailed narrative in summarySegments. There is no fixed character or word count; use the available 4096-token output budget according to the amount of source detail, without padding or arbitrary compression. Be as concise as possible without losing substantive content, character attribution, causal links or key details; remove repetition and low-information wording instead of removing facts. Use dense chronological segments and start a new segment when the present-character set changes or when the scene/topic materially changes. Each segment must preserve the scene and causal sequence; attribute every action, statement, belief and emotion to the correct named character; and retain exact decisions, promises, conditions, refusals, requests, secrets, plans, conflicts, relationship changes, emotional and tone shifts, unresolved matters and outcomes; and exact numbers, dates, locations, titles, objects and quoted terms. Never replace concrete details with generic phrases such as 'they discussed the matter'. Every segment must list all and only its exact supporting messageIds. Do not repeat the same narrative in a separate sessionSummary; the application joins summarySegments locally so output budget is spent on detail instead of duplicate prose.

Return at most 10 high-value durable memories for retrieval. These are an index, not a substitute for the detailed summarySegments. Do not impose a fixed character count on an individual memory; canonicalText should be one concise normalized sentence. Required shape:\n{"summarySegments":[{"content":"...","participants":[1],"visibility":"private|participants|known_group|public|world","messageIds":[0],"speakerIds":[1]}],"memories":[{"type":"event|promise|relationship|secret|belief|plan|conflict|information|rumor|unresolved|letter","subtype":"...","participants":[1],"subjects":[1],"content":"...","canonicalText":"...","importance":0.0,"confidence":0.0,"epistemicStatus":"asserted|believed|unverified","visibility":"private|participants|known_group|public|world","source":"witnessed|spoken|letter|reported|rumor|inferred","status":"open|resolved|null","unresolved":false,"relationshipImpact":null,"tags":[],"messageIds":[0],"speakerIds":[1]}]}`
      },
      ...(finalInstructions ? [{ role: "system", content: `Stable final-summary content instructions (apply these inside summarySegments and memories; they do not replace the required JSON format). Any fixed character-count or word-count target in older saved instructions is obsolete and must be ignored; the only size ceiling is the 4096-token provider output limit:\n${finalInstructions}` }] : []),
      { role: "system", content: `Conversation date: ${date || "unknown"}; totalDays: ${totalDays ?? "unknown"}\nParticipants:\n${participantText}\nPresence windows [joinedAt, leftBefore):\n${presenceText || "(all listed participants present for the full conversation)"}\nPrevious rolling summary:\n${rollingSummary || "(none)"}` },
      { role: "system", content: `Full conversation:\n${conversationText}` },
      { role: "user", content: "Extract the durable memories and session summary now." }
    ];
  }

  parseOutput(content, context = {}) {
    const text = String(content || "").trim();
    if (!text) return { structured: false, sessionSummary: "", memories: [] };
    let jsonText = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const firstBrace = jsonText.indexOf("{");
    const lastBrace = jsonText.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) jsonText = jsonText.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(jsonText);
      if (!parsed || !Array.isArray(parsed.memories)) throw new Error("missing_memories_array");
      const summarySegments = (Array.isArray(parsed.summarySegments) ? parsed.summarySegments : []).filter((candidate) => candidate && typeof candidate.content === "string" && candidate.content.trim()).map((candidate) => ({
        segmentId: candidate.segmentId || null,
        content: candidate.content.trim(),
        participants: Array.isArray(candidate.participants) ? candidate.participants : [],
        visibility: candidate.visibility || "participants",
        knownBy: Array.isArray(candidate.knownBy) ? candidate.knownBy : [],
        provenance: {
          conversationId: context.conversationId || null,
          messageIds: candidate.messageIds || candidate.provenance?.messageIds || [],
          speakerIds: candidate.speakerIds || candidate.provenance?.speakerIds || [],
          extractionMode: "structured_summary_segment",
          summaryRequestId: context.summaryRequestId || null
        }
      }));
      const memories = parsed.memories.filter((candidate) => candidate && typeof candidate.content === "string" && candidate.content.trim()).map((candidate) => createMemoryRecord({
        ...candidate,
        eventDate: candidate.eventDate || context.date || null,
        totalDays: candidate.totalDays ?? context.totalDays,
        provenance: {
          conversationId: context.conversationId || null,
          messageIds: candidate.messageIds || [],
          speakerIds: candidate.speakerIds || [],
          extractionMode: "structured",
          summaryRequestId: context.summaryRequestId || null
        }
      }));
      const sessionSummary = summarySegments.length > 0
        ? summarySegments.map((segment) => segment.content).join("\n\n")
        : String(parsed.sessionSummary || "").trim();
      return { structured: true, sessionSummary, summarySegments, memories };
    } catch (_error) {
      return {
        structured: false,
        sessionSummary: text,
        summarySegments: [],
        memories: [createMemoryRecord({
          type: "information",
          subtype: "session_summary_fallback",
          eventDate: context.date || null,
          totalDays: context.totalDays,
          participants: (context.participants || []).map((entry) => entry.id),
          subjects: (context.participants || []).map((entry) => entry.id),
          content: text,
          canonicalText: text,
          importance: 0.5,
          confidence: 0.65,
          source: "inferred",
          visibility: "participants",
          provenance: { conversationId: context.conversationId || null, messageIds: [], speakerIds: [], extractionMode: "prose_fallback", summaryRequestId: context.summaryRequestId || null }
        })]
      };
    }
  }
}

module.exports = { MemoryExtractor };
