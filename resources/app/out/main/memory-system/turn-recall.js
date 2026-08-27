"use strict";

const crypto = require("crypto");

const EXPLICIT_RECALL_INTENT = /(?:还记得|记不记得|是否记得|可记得|记得|想起|回想|之前|以前|上次|当时|曾经|那次|往日|约定|承诺|答应|说过|提到过|发生过)/i;
const QUERY_ALIAS_GROUPS = [
  ["约定", "约好", "承诺", "答应", "允诺"],
  ["婚约", "订婚", "许婚", "婚事"],
  ["结婚", "成婚", "婚约", "婚事"],
  ["敌人", "仇敌", "宿敌", "死敌"],
  ["朋友", "挚友", "至交", "友人"],
  ["情人", "恋人", "爱侣"],
  ["杀", "杀死", "处死", "斩杀"],
  ["给钱", "支付", "赠与", "交付金币"],
  ["冲突", "争执", "争吵", "矛盾"],
  ["信件", "书信", "来信", "回信"],
  ["离开", "离场", "告辞", "暂离"],
  ["昏迷", "失去意识", "不省人事"],
  ["秘密", "隐秘", "机密"]
];

function expandQuery(query) {
  const source = String(query || "").trim();
  const additions = [];
  for (const group of QUERY_ALIAS_GROUPS) {
    if (group.some((alias) => source.includes(alias))) additions.push(...group);
  }
  return Array.from(new Set([source, ...additions].filter(Boolean))).join(" ");
}

function createQueryFingerprint(query) {
  return crypto.createHash("sha256").update(String(query || "").trim().toLowerCase()).digest("hex").slice(0, 16);
}

function removeEntityNames(query, entityNames = []) {
  let source = String(query || "");
  const names = Array.from(new Set(entityNames.map((name) => String(name || "").trim()).filter((name) => name.length >= 2)))
    .sort((left, right) => right.length - left.length);
  for (const name of names) source = source.split(name).join(" ");
  return source.replace(/\s+/g, " ").trim();
}

function detectIntent(query, { entityNames = [] } = {}) {
  const source = String(query || "").trim();
  const explicit = EXPLICIT_RECALL_INTENT.test(source);
  const entityMatched = entityNames.some((name) => {
    const normalized = String(name || "").trim();
    return normalized.length >= 2 && source.includes(normalized);
  });
  return { triggered: explicit, reason: explicit ? "explicit_recall_intent" : "no_recall_intent", explicit, entityMatched };
}

module.exports = { expandQuery, createQueryFingerprint, removeEntityNames, detectIntent, EXPLICIT_RECALL_INTENT, QUERY_ALIAS_GROUPS };
