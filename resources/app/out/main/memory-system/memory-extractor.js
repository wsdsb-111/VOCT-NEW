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
        content: `VOTC Memory Engine 2.3 structured extraction. Return one JSON object only. Do not decide who knows a memory; knowledge is computed locally. Distinguish facts, beliefs, plans and rumors. Split memories when different people are the subject. participants are the people who acted in or directly took part in that event; subjects are only the people directly described by that memory. Do not copy every scene participant into subjects. Respect the supplied half-open presence windows: a character can participate in or hear message M only when joinedAt <= M.id < leftBefore. Never include a waiting character before joinedAt or a departed character at/after leftBefore. Always provide the exact supporting messageIds. Required shape:\n{"sessionSummary":"...","memories":[{"type":"event|promise|relationship|secret|belief|plan|conflict|information|rumor|unresolved|letter","subtype":"...","participants":[1],"subjects":[1],"content":"...","canonicalText":"...","importance":0.0,"confidence":0.0,"epistemicStatus":"asserted|believed|unverified","visibility":"private|participants|known_group|public|world","source":"witnessed|spoken|letter|reported|rumor|inferred","status":"open|resolved|null","unresolved":false,"relationshipImpact":null,"tags":[],"messageIds":[0],"speakerIds":[1]}]}`
      },
      ...(finalInstructions ? [{ role: "system", content: `Stable final-summary content instructions (apply these inside sessionSummary and memories; they do not replace the required JSON format):\n${finalInstructions}` }] : []),
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
      return { structured: true, sessionSummary: String(parsed.sessionSummary || "").trim(), memories };
    } catch (_error) {
      return {
        structured: false,
        sessionSummary: text,
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
