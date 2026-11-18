"use strict";

const { normalizeGameDate } = require("../worldline/character-temporal-facts");
const { removeQuotedText } = require("./pair-memory-routing");

// Whole days. Shared boundaries belong to the longer band; 3 days stays in 2–3.
const BANDS = [
  [0, "同一天；可以承接，但别说隔了一天。"],
  [1, "隔了一天；记得昨日的事，当作近期接续。"],
  [2, "隔了两三天；可以自然问进展，别当成刚刚答应。"],
  [4, "隔了几天、不到一周；可承认已有时间办短差。"],
  [7, "隔了约一到两周；可留意这段时间有没有消息。"],
  [15, "隔了半月到近一月；可感到等候，照约定判断是否该追问。"],
  [30, "隔了数周至数月；自然接续旧约，也可问事情是否有变化。"],
  [90, "隔了一季至近半年；对进展无消息可感慨，别假定情况如初。"],
  [180, "隔了半年到近一年；可重新了解人事变化，别当成昨日的事。"],
  [365, "隔了一年或更久；按久别与旧事回应，必要时确认条件是否还适用。"]
];

const TIME_CUE = /多久|何时|什么时候|几(?:天|日|周|月|年)|[几数多一二两三四五六七八九十百\d]+(?:天|日|周|月|年)(?:前|后|了|内|半|才)|前[日天]|昨[日天]|明[日天]|隔了|好久不见|久别|上次.{0,5}(?:见|谈|聊)|\b(?:how long|how many days|yesterday|tomorrow|long time no see|last (?:time we (?:met|spoke)|week|month|year)|(?:days|weeks|months|years) ago)\b/iu;
const AGREEMENT = /答应|承诺|约定|约好|托付|托你|托我|交代|委托|奉命|将在|打算|计划|尚未|待办|\b(?:promised?|pledged?|agreed|asked (?:me|you) to|entrusted|planned|pending)\b/iu;
const TASK_CUE = /进展|办(?:得如何|得怎样|妥|好|完|成|了)|完成|买|捎来|带回|拿来[了啦]|送达|交付|出发|动身|抵达|赶到|启程|路程|行程|赶路|远行|我回来了|回报|汇报|期限|到期|延期|推迟|那件事|上次.{0,5}(?:那件|说过|交代)|\b(?:progress|deadline|finished|completed|bought|purchased|delivered|arrived|journey|travel|reported back|i(?: am|m) back)\b/iu;
const TASK_VERB = /采购|买|购|送|交付|赴|前往|抵达|远行|修建|建造|筹备|搜寻|调查|取回|带回|\b(?:buy|purchase|deliver|travel|build|find|fetch|investigate)\b/iu;
const FOLLOW_UP = /那件事|办得(?:如何|怎样)|(?:这件事|上次|前日).{0,12}(?:进展|如何|怎样|办)|\b(?:that task|how did it go|any progress)\b/iu;
const TASK_FAMILIES = [/采购|买|购|\b(?:buy|bought|purchase[d]?)\b/iu, /送达|交付|送往|捎到|\bdeliver(?:ed|y)?\b/iu,
  /出发|动身|远行|抵达|赶到|启程|路程|旅行|走到|赴|前往|\b(?:travel|journey|arrived|departed)\b/iu];
const STOP_WORDS = /我|你|他|这(?:件事)?|那(?:件事)?|前日|昨日|今天|已经|上次|答应|承诺|约定|约好|托付|事情|帮忙|完成|办妥|买到|买了|买回|了|(?:\b(?:the|that|this|you|we|had|have|was|were|went|did|done|today|yesterday|tomorrow|will|can|told|with|from|for|promised|asked|agreed|bought|arrived)\b)/giu;

function elapsedBand(days) {
  return Number.isSafeInteger(days) && days >= 0 ? BANDS.findLast(([start]) => days >= start) : null;
}

function topicWords(text) {
  return text.replace(STOP_WORDS, " ").match(/[\p{Script=Han}]{2,}|[a-z]{4,}/giu) || [];
}

function buildTurnTiming({ trustedPlayerTurn, currentGameDate, ownerId, playerId, direct = [], items = [] }) {
  if (trustedPlayerTurn?.trusted !== true || trustedPlayerTurn.isCurrent !== true) return null;
  const query = removeQuotedText(String(trustedPlayerTurn.content || "").replace(/(\w)[’'](?=\w)/g, "$1"));
  const timeCue = TIME_CUE.test(query);
  const taskCue = TASK_CUE.test(query) || AGREEMENT.test(query) && TASK_VERB.test(query);
  if (!timeCue && !taskCue) return null;
  const today = normalizeGameDate(currentGameDate);
  if (!today) return null;
  const checkedDate = value => {
    const date = normalizeGameDate(value);
    return date && date.serial <= today.serial ? date : null;
  };
  let last = null;
  for (const { memory } of direct) {
    const source = memory?.provenance;
    if (source?.sourceLetterId || source?.conversationId === trustedPlayerTurn.conversationId) continue;
    if (playerId != null && (!memory?.participants?.includes(playerId) || !memory.participants.includes(ownerId))) continue;
    const date = checkedDate(memory?.eventDate);
    if (date && (!last || date.serial > last.serial)) last = date;
  }
  let matches = [];
  if (taskCue) {
    const words = topicWords(query.toLowerCase());
    const rows = items.flatMap(item => {
      if (playerId != null && (item.scope?.ownerId !== ownerId || item.scope?.counterpartId !== playerId)) return [];
      const date = checkedDate(item.conversationDate);
      const text = typeof item.text === "string" ? item.text.replace(/\s+/g, " ").trim() : "";
      // Do not clip a record: the omitted part could contain a condition, refusal or outcome.
      return date && item.source?.conversationId !== trustedPlayerTurn.conversationId
        && text && text.length <= 180 ? [{ text, date }] : [];
    });
    const agreements = rows.filter(row => AGREEMENT.test(row.text));
    const byTopic = row => words.some(word => row.text.toLowerCase().includes(word));
    const byFamily = row => TASK_FAMILIES.some(re => re.test(query) && re.test(row.text));
    const exact = agreements.filter(byTopic);
    const likely = agreements.filter(row => byFamily(row) || FOLLOW_UP.test(query));
    matches = exact.length ? exact : likely.length === 1 ? likely : [];
    // Preserve later reported outcomes for the same explicit topic if the ledger contains them.
    if (exact.length) matches = [...exact, ...rows.filter(row => !AGREEMENT.test(row.text) && TASK_CUE.test(row.text) && byTopic(row))];
  }
  const lines = [`【本轮游戏时间核对】当前日期：${today.display}。只在本轮话题需要时使用；不要逐项复述。`];
  if (last) {
    const elapsed = today.serial - last.serial;
    lines.push(`距最近一次有记录的共同交谈：${elapsed}个游戏日。语气参考：${elapsedBand(elapsed)[1]}`);
  }
  const seen = new Set();
  for (const { text, date } of matches.sort((a, b) => b.date.serial - a.date.serial)) {
    if (seen.has(text)) continue;
    seen.add(text);
    const elapsed = today.serial - date.serial;
    lines.push(`- ${date.display}的谈话记录（距今${elapsed}日）：${text}`);
    if (seen.size === 3) break;
  }
  if (matches.length) lines.push("记录日期是谈话日期；正文若明确给出事件日期，按事件日期理解。分别考虑隔了多久没见与差事实际等候了多久。后来的提及不重置工期；仅用与本轮所指确实一致的记录。");
  if (taskCue) lines.push("若谈到任务进展：明确说定的期限优先；‘明天’等以说这话的当天为准。沿用人物已知的可信估计，除非条件变了。没有估计时，按距离、路线、交通方式、季节与难度判断合理范围；依据不足就保持不确定。附近简单采购可能约一天，跨大陆行程可能需要数年。估计不是约定；即使超过明确期限，时间也不能证明失败。没有消息可自然问一次。明确肯定回报须按当事人已报告的结果回应；只有当前可信游戏事实或本人亲见才算核实。计划、疑问、否认或假设不算完成回报。快于预期可以自然询问缘由，不自动否定、执行或重做。不要用旧计划覆盖后来已知的结果。");
  return lines.join("\n");
}

module.exports = { buildTurnTiming, elapsedBand };
