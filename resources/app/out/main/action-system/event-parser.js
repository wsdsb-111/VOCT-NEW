"use strict";

const candidateGate = require("./candidate-gate");
const { createActionEvent } = require("./action-types");

function parse(text, { registry } = {}) {
    const source = typeof text === "string" ? text : "";
    if (!source.trim()) return { events: [], rejectedCandidates: [] };
    const rejectedCandidates = [];
    const clauses = [];
    const basePattern = /[^。！？；，.!?;,\n]+[。！？；，.!?;,\n]?/g;
    let baseMatch;
    while ((baseMatch = basePattern.exec(source)) !== null) {
      const baseText = baseMatch[0];
      const splitPattern = /(?:只是|反而|而是|但最终|不过|但是|然而|随后|然后|接着|最后|但(?=(?:我|你|他|她|它|众人|这|那|此|可)))/g;
      let cursor = 0;
      let splitMatch;
      while ((splitMatch = splitPattern.exec(baseText)) !== null) {
        const before = baseText.slice(cursor, splitMatch.index);
        if (before.trim()) {
          const offset = before.search(/\S/);
          clauses.push({ text: before.trim(), start: baseMatch.index + cursor + offset });
        }
        cursor = splitMatch.index + splitMatch[0].length;
      }
      const remaining = baseText.slice(cursor);
      if (remaining.trim()) {
        const offset = remaining.search(/\S/);
        clauses.push({ text: remaining.trim(), start: baseMatch.index + cursor + offset });
      }
    }
    if (clauses.length === 0) clauses.push({ text: source.trim(), start: source.search(/\S/) });
    const hypotheticalMarker = /(?:如果|假如|倘若|若是|要是|也许|或许|可能会|\b(?:if|maybe|perhaps|might|could)\b)/i;
    const recalledOrReportedMarker = /(?:想起|回忆|昨天|曾(?:经)?|听说|传闻|据说|声称|讲述|描述|\b(?:yesterday|remember|heard|rumou?r(?:ed)?)\b)/i;
    const failedBeforeExecutionMarker = /(?:试图|尝试|企图).{0,30}(?:没能|未能|卡在|失败|落空|无法|没有成功|\b(?:failed|stuck|could not)\b)/i;
    const failedResultMarker = /(?:躲开|避开|闪开|格挡|招架|挡下|未命中|落空|\b(?:dodged|avoided|blocked|missed)\b)/i;
    // Hints are already concrete action candidates. Reject any clause led by
    // a plan, request, question, near-miss, or negation regardless of action
    // category so new registry metadata cannot bypass the execution boundary.
    const nonExecutedMarker = /(?:[？?]|(?:^|[，,；;])\s*(?:(?:明天|明日|稍后|待会|待会儿|将来|总有一天)\s*)?(?:我|你|他|她|它|我们|你们|他们|她们|众人)?\s*(?:(?:明天|明日|稍后|待会|待会儿|将来|总有一天)\s*)?(?:请|命令|要求|让|叫|希望|想|要|欲|准备|打算|计划|将(?:要|会)|会|能否|可否|是否|别|不要|莫|不许|不准|差点|险些|几乎))/i;
    const explicitFutureMarker = /(?:^|[，,；;])\s*(?:我|你|他|她|它|我们|你们|他们|她们|众人)?\s*(?:过会儿|等下|迟些时候|改日)\s*(?:我|你|他|她|它|我们|你们|他们|她们|众人)?\s*(?:就|再)?/i;
    const negatedActionMarker = /(?:^|[，,；;])\s*(?:我|你|他|她|它|我们|你们|他们|她们|众人)?\s*(?:没有|并未|不曾|未曾|尚未)/i;
    const posthocNegationMarker = /(?:——|—|\.\.\.|…|至少).{0,24}(?:不[，,]?|只是做了个梦|也许没有|本来是这么打算)/i;
    const isPostActionQualifier = (clause) => /(?:杀死|杀了|刺伤|砍伤|打伤|关进|关押|囚禁|任命|罢免|雇佣|招募|亲吻|接吻).{0,16}(?:也许|或许|可能会)/i.test(clause);
    const events = [];
    for (let index = 0; index < clauses.length; index++) {
      const clause = clauses[index];
      const hints = candidateGate.detect(clause.text, { candidateOnly: true }, { registry });
      if (hints.length === 0) continue;
      const candidateEvidence = { text: clause.text, start: clause.start, end: clause.start + clause.text.length };
      if (nonExecutedMarker.test(clause.text) || explicitFutureMarker.test(clause.text)) {
        for (const category of hints) rejectedCandidates.push({ category, evidence: candidateEvidence, rejectionReason: "non_executed" });
        continue;
      }
      if (negatedActionMarker.test(clause.text)) {
        for (const category of hints) rejectedCandidates.push({ category, evidence: candidateEvidence, rejectionReason: "negated" });
        continue;
      }
      if (posthocNegationMarker.test(clause.text) || clauses.slice(index + 1, index + 2).some((nextClause) => /^(?:也许|或许)?\s*(?:没有|并未|不曾|未曾|不是)/.test(nextClause.text))) {
        for (const category of hints) rejectedCandidates.push({ category, evidence: candidateEvidence, rejectionReason: "posthoc_negation" });
        continue;
      }
      const previousClause = index > 0 ? clauses[index - 1] : null;
      const connectorText = previousClause
        ? source.slice(previousClause.start + previousClause.text.length, clause.start)
        : "";
      const inheritsHypothetical = previousClause
        && /^\s*(?:如果|假如|倘若|若是|要是|若|\bif\b)/i.test(previousClause.text)
        && !/(?:不过|但是|然而|反而|而是|但最终|随后|然后|接着|最后)/.test(connectorText);
      if (inheritsHypothetical || hypotheticalMarker.test(clause.text) && (/^\s*(?:如果|假如|倘若|若是|要是|若|\bif\b)/i.test(clause.text) || !isPostActionQualifier(clause.text))) {
        for (const category of hints) rejectedCandidates.push({ category, evidence: candidateEvidence, rejectionReason: "hypothetical" });
        continue;
      }
      if (recalledOrReportedMarker.test(clause.text)) {
        for (const category of hints) rejectedCandidates.push({ category, evidence: candidateEvidence, rejectionReason: "recalled_or_reported" });
        continue;
      }
      const failedBeforeExecution = failedBeforeExecutionMarker.test(clause.text) || /(?:试图|尝试|企图)/.test(clause.text) && clauses.slice(index + 1, index + 2).some((nextClause) => /(?:没能|未能|卡在|失败|落空|无法|没有成功|拒绝|推开|挣脱|\b(?:failed|stuck|could not|refused)\b)/i.test(nextClause.text));
      if (failedBeforeExecution) {
        for (const category of hints) rejectedCandidates.push({ category, evidence: candidateEvidence, rejectionReason: "failed_before_execution" });
        continue;
      }
      for (const category of hints) {
        const resultFailed = category === "combat" && clauses.slice(index + 1, index + 2).some((nextClause) => failedResultMarker.test(nextClause.text));
        events.push({
          category,
          evidence: candidateEvidence,
          executionStatus: "executed",
          resultStatus: resultFailed ? "failed" : "succeeded",
          sourceClauseIndex: index
        });
      }
    }
    events.sort((left, right) => left.evidence.start - right.evidence.start || left.sourceClauseIndex - right.sourceClauseIndex);
    return {
      events: events.map((event, index) => createActionEvent({ ...event, eventId: `evt_${index + 1}` })),
      rejectedCandidates
    };
  }

module.exports = { parse };
