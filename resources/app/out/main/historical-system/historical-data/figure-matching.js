"use strict";

const { figures } = require("./figures");

const emptyHints = () => ({ cultures: [], houses: [], titles: [], positions: [], realms: [], locations: [] });
const reviewed = (figureKey, birthYear, cultures, source) => ({
  figureKey,
  resolverReady: true,
  intrinsic: { gender: "male", birthYear },
  hints: { ...emptyHints(), cultures },
  familyHints: [],
  confidencePolicy: "standard",
  reviewed: true,
  sources: [source]
});

const reviewedRecords = new Map([
  reviewed("zhu_wen", 852, ["汉"], "https://zh.wikipedia.org/wiki/朱温"),
  reviewed("li_keyong", 856, ["沙陀"], "https://zh.wikipedia.org/wiki/李克用"),
  reviewed("li_cunxu", 885, ["沙陀"], "https://zh.wikipedia.org/wiki/李存勖"),
  reviewed("shi_jingtang", 892, ["沙陀"], "https://zh.wikipedia.org/wiki/石敬瑭"),
  reviewed("chai_rong", 921, ["汉"], "https://zh.wikipedia.org/wiki/柴荣"),
  reviewed("zhao_kuangyin", 927, ["汉"], "https://zh.wikipedia.org/wiki/赵匡胤"),
  reviewed("kou_zhun", 961, ["汉"], "https://zh.wikipedia.org/wiki/寇准"),
  reviewed("fan_zhongyan", 989, ["汉"], "https://zh.wikipedia.org/wiki/范仲淹"),
  reviewed("wang_anshi", 1021, ["汉"], "https://zh.wikipedia.org/wiki/王安石"),
  reviewed("su_shi", 1037, ["汉"], "https://zh.wikipedia.org/wiki/苏轼"),
  reviewed("yue_fei", 1103, ["汉"], "https://zh.wikipedia.org/wiki/岳飞"),
  reviewed("xin_qiji", 1140, ["汉"], "https://zh.wikipedia.org/wiki/辛弃疾"),
  reviewed("kublai_khan", 1215, ["蒙古"], "https://www.dpm.org.cn/lemmas/242765.html"),
  reviewed("wen_tianxiang", 1236, ["汉"], "https://www.dpm.org.cn/lemmas/243027.html")
].map((record) => [record.figureKey, record]));

const figureMatchingRecords = figures.map((figure) => reviewedRecords.get(figure.figureKey) || {
  figureKey: figure.figureKey,
  resolverReady: false,
  intrinsic: { gender: null, birthYear: null },
  hints: emptyHints(),
  familyHints: [],
  confidencePolicy: "conservative",
  reviewed: false,
  sources: []
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

deepFreeze(figureMatchingRecords);

module.exports = { figureMatchingRecords };
