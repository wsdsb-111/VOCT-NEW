"use strict";

function fixTypingErrors(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map((item) => fixTypingErrors(item));
  if (typeof obj === "object") {
    const fixed = {};
    for (const [key, value] of Object.entries(obj)) fixed[key] = fixTypingErrors(value);
    return fixed;
  }
  if (typeof obj === "string") {
    const trimmed = obj.trim();
    if (trimmed !== "" && !isNaN(Number(trimmed)) && /^-?\d+\.?\d*$/.test(trimmed)) return Number(trimmed);
    if (trimmed.toLowerCase() === "true") return true;
    if (trimmed.toLowerCase() === "false") return false;
  }
  return obj;
}

function healJsonResponse(content) {
  if (!content || typeof content !== "string") return null;
  try {
    return fixTypingErrors(JSON.parse(content));
  } catch {}
  const markdownMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (markdownMatch) {
    try {
      return fixTypingErrors(JSON.parse(markdownMatch[1].trim()));
    } catch {
      content = markdownMatch[1].trim();
    }
  }
  const jsonStart = Math.min(
    content.indexOf("{") !== -1 ? content.indexOf("{") : Infinity,
    content.indexOf("[") !== -1 ? content.indexOf("[") : Infinity
  );
  if (jsonStart !== Infinity) {
    const startChar = content[jsonStart];
    const endChar = startChar === "{" ? "}" : "]";
    const jsonEnd = content.lastIndexOf(endChar);
    if (jsonEnd > jsonStart) {
      const extracted = content.substring(jsonStart, jsonEnd + 1);
      try {
        return fixTypingErrors(JSON.parse(extracted));
      } catch {
        content = extracted;
      }
    }
  }
  let repaired = content.trim();
  repaired = repaired.replace(/,(\s*[}\]])/g, "$1");
  repaired = repaired.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
  const openBraces = (repaired.match(/{/g) || []).length;
  const closeBraces = (repaired.match(/}/g) || []).length;
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/\]/g) || []).length;
  if (openBraces > closeBraces) repaired += "}".repeat(openBraces - closeBraces);
  if (openBrackets > closeBrackets) repaired += "]".repeat(openBrackets - closeBrackets);
  try {
    return fixTypingErrors(JSON.parse(repaired));
  } catch {
    return null;
  }
}

function healJsonResponseWithLogging(content, context = "JSON", logVerbose = () => {}) {
  console.log(`[${context}] Attempting to heal JSON response`);
  console.log(`[${context}] Original content length: ${content?.length || 0} characters`);
  const healed = healJsonResponse(content);
  if (healed !== null) {
    console.log(`[${context}] Successfully healed JSON response`);
    return healed;
  }
  console.error(`[${context}] Failed to heal JSON response`);
  logVerbose(`[${context}][verbose] Original content:`, content?.substring(0, 500));
  return null;
}

module.exports = { fixTypingErrors, healJsonResponse, healJsonResponseWithLogging };
