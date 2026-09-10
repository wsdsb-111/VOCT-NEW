"use strict";

const INTENTS = [
  { terms: ["你儿子", "你的儿子"], relationTypes: ["CHILD_OF"], sexConstraint: "male", label: "儿子", anchorMode: "RESPONDER" },
  { terms: ["你女儿", "你的女儿"], relationTypes: ["CHILD_OF"], sexConstraint: "female", label: "女儿", anchorMode: "RESPONDER" },
  { terms: ["你子女", "你的孩子"], relationTypes: ["CHILD_OF"], sexConstraint: null, label: "子女", anchorMode: "RESPONDER" },
  { terms: ["你父亲", "你爹"], relationTypes: ["PARENT_OF"], sexConstraint: "male", label: "父亲", anchorMode: "RESPONDER" },
  { terms: ["你母亲", "你娘"], relationTypes: ["PARENT_OF"], sexConstraint: "female", label: "母亲", anchorMode: "RESPONDER" },
  { terms: ["你父母"], relationTypes: ["PARENT_OF"], sexConstraint: null, label: "父母", anchorMode: "RESPONDER" },
  { terms: ["你祖父", "你爷爷"], relationTypes: ["GRANDPARENT_OF"], sexConstraint: "male", label: "祖父", anchorMode: "RESPONDER" },
  { terms: ["你祖母", "你奶奶"], relationTypes: ["GRANDPARENT_OF"], sexConstraint: "female", label: "祖母", anchorMode: "RESPONDER" },
  { terms: ["你孙子"], relationTypes: ["GRANDCHILD_OF"], sexConstraint: "male", label: "孙子", anchorMode: "RESPONDER" },
  { terms: ["你孙女"], relationTypes: ["GRANDCHILD_OF"], sexConstraint: "female", label: "孙女", anchorMode: "RESPONDER" },
  { terms: ["你兄长", "你哥哥"], relationTypes: ["SIBLING_OF"], sexConstraint: "male", label: "兄长", anchorMode: "RESPONDER", birthOrder: "older" },
  { terms: ["你弟弟"], relationTypes: ["SIBLING_OF"], sexConstraint: "male", label: "弟弟", anchorMode: "RESPONDER", birthOrder: "younger" },
  { terms: ["你兄弟"], relationTypes: ["SIBLING_OF"], sexConstraint: "male", label: "兄弟", anchorMode: "RESPONDER" },
  { terms: ["你姐姐"], relationTypes: ["SIBLING_OF"], sexConstraint: "female", label: "姐姐", anchorMode: "RESPONDER", birthOrder: "older" },
  { terms: ["你妹妹"], relationTypes: ["SIBLING_OF"], sexConstraint: "female", label: "妹妹", anchorMode: "RESPONDER", birthOrder: "younger" },
  { terms: ["你姐妹"], relationTypes: ["SIBLING_OF"], sexConstraint: "female", label: "姐妹", anchorMode: "RESPONDER" },
  { terms: ["你已故妻子", "你的已故妻子", "你亡妻", "你的亡妻"], relationTypes: ["DECEASED_SPOUSE_OF"], spouseStatus: "DECEASED", sexConstraint: "female", label: "亡妻", anchorMode: "RESPONDER" },
  { terms: ["你已故丈夫", "你的已故丈夫", "你亡夫", "你的亡夫"], relationTypes: ["DECEASED_SPOUSE_OF"], spouseStatus: "DECEASED", sexConstraint: "male", label: "亡夫", anchorMode: "RESPONDER" },
  { terms: ["你已故配偶", "你的已故配偶"], relationTypes: ["DECEASED_SPOUSE_OF"], spouseStatus: "DECEASED", sexConstraint: null, label: "已故配偶", anchorMode: "RESPONDER" },
  { terms: ["你前妻", "你的前妻"], relationTypes: ["FORMER_SPOUSE_OF"], spouseStatus: "FORMER", sexConstraint: "female", label: "前妻", anchorMode: "RESPONDER" },
  { terms: ["你前夫", "你的前夫"], relationTypes: ["FORMER_SPOUSE_OF"], spouseStatus: "FORMER", sexConstraint: "male", label: "前夫", anchorMode: "RESPONDER" },
  { terms: ["你前配偶", "你的前配偶"], relationTypes: ["FORMER_SPOUSE_OF"], spouseStatus: "FORMER", sexConstraint: null, label: "前配偶", anchorMode: "RESPONDER" },
  { terms: ["你妻子", "你的妻子", "你夫人", "你的夫人"], relationTypes: ["SPOUSE_OF"], spouseStatus: "CURRENT", sexConstraint: "female", label: "妻子", anchorMode: "RESPONDER" },
  { terms: ["你丈夫", "你的丈夫", "你夫君", "你的夫君"], relationTypes: ["SPOUSE_OF"], spouseStatus: "CURRENT", sexConstraint: "male", label: "丈夫", anchorMode: "RESPONDER" },
  { terms: ["你配偶", "你的配偶"], relationTypes: ["SPOUSE_OF"], spouseStatus: "CURRENT", sexConstraint: null, label: "配偶", anchorMode: "RESPONDER" },
  { terms: ["最近得的儿子", "新得一子", "又得一子", "得一子", "添了一子", "添一子", "得子", "添子", "麟儿"], relationTypes: ["CHILD_OF"], sexConstraint: "male", label: "儿子", recency: "latest", anchorMode: "EXPLICIT" },
  { terms: ["最近得的女儿", "新得一女", "又得一女", "得一女", "添了一女", "添一女", "得女", "添女", "千金"], relationTypes: ["CHILD_OF"], sexConstraint: "female", label: "女儿", recency: "latest", anchorMode: "EXPLICIT" },
  { terms: ["儿子", "子嗣", "后嗣", "嗣子"], relationTypes: ["CHILD_OF"], sexConstraint: "male", label: "儿子", anchorMode: "EXPLICIT" },
  { terms: ["女儿"], relationTypes: ["CHILD_OF"], sexConstraint: "female", label: "女儿", anchorMode: "EXPLICIT" },
  { terms: ["长子"], relationTypes: ["CHILD_OF"], sexConstraint: "male", label: "长子", birthOrder: "first", anchorMode: "EXPLICIT" },
  { terms: ["次子"], relationTypes: ["CHILD_OF"], sexConstraint: "male", label: "次子", birthOrder: "second", anchorMode: "EXPLICIT" },
  { terms: ["三子"], relationTypes: ["CHILD_OF"], sexConstraint: "male", label: "三子", birthOrder: "third", anchorMode: "EXPLICIT" },
  { terms: ["幼子"], relationTypes: ["CHILD_OF"], sexConstraint: "male", label: "幼子", birthOrder: "last", anchorMode: "EXPLICIT" },
  { terms: ["长女"], relationTypes: ["CHILD_OF"], sexConstraint: "female", label: "长女", birthOrder: "first", anchorMode: "EXPLICIT" },
  { terms: ["次女"], relationTypes: ["CHILD_OF"], sexConstraint: "female", label: "次女", birthOrder: "second", anchorMode: "EXPLICIT" },
  { terms: ["幼女"], relationTypes: ["CHILD_OF"], sexConstraint: "female", label: "幼女", birthOrder: "last", anchorMode: "EXPLICIT" },
  { terms: ["父亲", "父王", "父皇", "爹"], relationTypes: ["PARENT_OF"], sexConstraint: "male", label: "父亲", anchorMode: "EXPLICIT" },
  { terms: ["母亲", "母后", "母妃", "娘"], relationTypes: ["PARENT_OF"], sexConstraint: "female", label: "母亲", anchorMode: "EXPLICIT" },
  { terms: ["兄长", "哥哥"], relationTypes: ["SIBLING_OF"], sexConstraint: "male", label: "兄长", birthOrder: "older", anchorMode: "EXPLICIT" },
  { terms: ["弟弟"], relationTypes: ["SIBLING_OF"], sexConstraint: "male", label: "弟弟", birthOrder: "younger", anchorMode: "EXPLICIT" },
  { terms: ["姐姐"], relationTypes: ["SIBLING_OF"], sexConstraint: "female", label: "姐姐", birthOrder: "older", anchorMode: "EXPLICIT" },
  { terms: ["妹妹"], relationTypes: ["SIBLING_OF"], sexConstraint: "female", label: "妹妹", birthOrder: "younger", anchorMode: "EXPLICIT" },
  { terms: ["已故妻子", "亡妻"], relationTypes: ["DECEASED_SPOUSE_OF"], spouseStatus: "DECEASED", sexConstraint: "female", label: "亡妻", anchorMode: "EXPLICIT" },
  { terms: ["已故丈夫", "亡夫"], relationTypes: ["DECEASED_SPOUSE_OF"], spouseStatus: "DECEASED", sexConstraint: "male", label: "亡夫", anchorMode: "EXPLICIT" },
  { terms: ["已故配偶"], relationTypes: ["DECEASED_SPOUSE_OF"], spouseStatus: "DECEASED", sexConstraint: null, label: "已故配偶", anchorMode: "EXPLICIT" },
  { terms: ["前妻"], relationTypes: ["FORMER_SPOUSE_OF"], spouseStatus: "FORMER", sexConstraint: "female", label: "前妻", anchorMode: "EXPLICIT" },
  { terms: ["前夫"], relationTypes: ["FORMER_SPOUSE_OF"], spouseStatus: "FORMER", sexConstraint: "male", label: "前夫", anchorMode: "EXPLICIT" },
  { terms: ["前配偶"], relationTypes: ["FORMER_SPOUSE_OF"], spouseStatus: "FORMER", sexConstraint: null, label: "前配偶", anchorMode: "EXPLICIT" },
  { terms: ["妻子", "夫人", "王妃", "正妻", "继室"], relationTypes: ["SPOUSE_OF"], spouseStatus: "CURRENT", sexConstraint: "female", label: "妻子", anchorMode: "EXPLICIT" },
  { terms: ["丈夫", "夫君"], relationTypes: ["SPOUSE_OF"], spouseStatus: "CURRENT", sexConstraint: "male", label: "丈夫", anchorMode: "EXPLICIT" },
  { terms: ["配偶"], relationTypes: ["SPOUSE_OF"], spouseStatus: "CURRENT", sexConstraint: null, label: "配偶", anchorMode: "EXPLICIT" }
];

function parseRelationIntent(query = "") {
  const text = String(query || "");
  const matches = INTENTS.flatMap((intent) => intent.terms.map((term) => ({ intent, term, index: text.lastIndexOf(term) }))).filter((match) => match.index >= 0);
  const match = matches.sort((left, right) => right.index + right.term.length - (left.index + left.term.length) || right.term.length - left.term.length || right.index - left.index)[0];
  if (!match) return { detected: false, relationTypes: [], spouseStatus: null, sexConstraint: null, birthOrder: null, recency: null, anchorMention: null, sourcePhrase: null, confidence: "NONE", anchorMode: null };
  return {
    detected: true,
    relationTypes: match.intent.relationTypes,
    spouseStatus: match.intent.spouseStatus || null,
    sexConstraint: match.intent.sexConstraint,
    birthOrder: match.intent.birthOrder || null,
    recency: match.intent.recency || null,
    anchorMention: null,
    sourcePhrase: match.term,
    sourceIndex: match.index,
    confidence: "HIGH",
    label: match.intent.label,
    anchorMode: match.intent.anchorMode
  };
}

module.exports = { parseRelationIntent };
