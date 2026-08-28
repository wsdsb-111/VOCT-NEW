"use strict";

const MONEY_UNIT_PATTERN = /(?:金币?|银币?|铜钱|文钱?|贯钱?|两(?:银子?)?|银子|钱|金|银|财物)/i;
const MONEY_TRANSFER_VERB_PATTERN = /(?:给|给了|给予|交给|交付|递给|支付|付给|打赏|赏赐|赏给|赠予|赠与|赠送|转给|转交|赔给|赔付|偿还|奉上|献上|塞给|给钱|送钱|奉还|归还)/i;
const MONEY_TRANSFER_PATTERN = new RegExp(
  `(?:${MONEY_TRANSFER_VERB_PATTERN.source}).{0,16}(?:${MONEY_UNIT_PATTERN.source})|(?:${MONEY_UNIT_PATTERN.source}).{0,16}(?:${MONEY_TRANSFER_VERB_PATTERN.source})`,
  "i"
);
const MONEY_TRANSFER_FAILURE_PATTERN = /(?:拒绝(?:了)?(?:接|收|接受)?|没有(?:接|收下|接受|拿走)|未(?:接|收下|接受)|(?:最后|最终)?没有给|并未给出)/i;

function test(pattern, text) {
  pattern.lastIndex = 0;
  return pattern.test(String(text || ""));
}

function isMoneyTransfer(text) {
  return test(MONEY_TRANSFER_PATTERN, text);
}

function findMoneyTransferIndex(text) {
  MONEY_TRANSFER_PATTERN.lastIndex = 0;
  return MONEY_TRANSFER_PATTERN.exec(String(text || ""))?.index ?? -1;
}

module.exports = {
  MONEY_UNIT_PATTERN,
  MONEY_TRANSFER_VERB_PATTERN,
  MONEY_TRANSFER_PATTERN,
  MONEY_TRANSFER_FAILURE_PATTERN,
  isMoneyTransfer,
  findMoneyTransferIndex
};
