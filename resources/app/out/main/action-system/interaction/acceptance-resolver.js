"use strict";

const ACCEPT = /^(?:我愿意|愿意|我答应|答应|可以|好|好吧|就这么办|就这么定了|依你|便依你|善|可|允了|准了|便如此|臣领命|谨遵|愿从之|一言为定|成交)$/i;
const REJECT = /^(?:不愿|不可|不行|拒绝|不同意|休想|不可能|此事作罢|恕难从命|万万不可|绝无可能)$/i;
const UNCERTAIN = /^(?:让我想想|以后再说|此事|容我考虑|改日再议)$/i;
const GENERIC_ACCEPT = /^(?:好|好吧|可以|可|善)$/i;

function normalize(text) {
  return String(text || "").trim().replace(/[。！？!?…，,；;]+$/g, "").trim();
}

function resolve(text) {
  const normalized = normalize(text);
  if (!normalized) return { decision: "none", generic: false };
  if (REJECT.test(normalized)) return { decision: "reject", generic: false };
  if (UNCERTAIN.test(normalized)) return { decision: "uncertain", generic: false };
  if (ACCEPT.test(normalized)) return { decision: "accept", generic: GENERIC_ACCEPT.test(normalized) };
  return { decision: "none", generic: false };
}

module.exports = { resolve, normalize, ACCEPT, REJECT, UNCERTAIN };
