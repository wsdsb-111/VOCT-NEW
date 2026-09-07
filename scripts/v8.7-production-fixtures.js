"use strict";

function characterLine(id, shortName, fullName, pronoun, consort = "") {
  const raw = Array(27).fill("");
  raw[0] = String(id);
  raw[1] = shortName;
  raw[2] = fullName;
  raw[3] = "无";
  raw[4] = pronoun;
  raw[5] = "52";
  raw[6] = "100";
  raw[8] = "未知";
  raw[9] = "沉稳";
  raw[13] = consort;
  raw[14] = "汉";
  raw[15] = "儒教";
  return ["VOTC:IN", "character", ...raw].join("/;/");
}

function productionFamilyLogLines() {
  return [
    ["VOTC:IN", "init", "1", "玩家", "2", "主角", "1171年9月20日", "scene_type_court", "临安", "玩家", "428018"].join("/;/"),
    characterLine(2, "主角", "测试主角", "他", "王氏"),
    ["VOTC:IN", "parents", "2", "10", "父亲", "409000", "1119年8月1日"].join("/;/"),
    ["VOTC:IN", "parent_death", "2", "10", "428000", "1171年9月2日", "MURDER"].join("/;/"),
    ["VOTC:IN", "kids", "2", "11", "女儿", "她", "420000", "1149年1月1日"].join("/;/"),
    ["VOTC:IN", "kid_death", "2", "11", "428000", "1171年9月2日", "DISEASE"].join("/;/"),
    ["VOTC:IN", "kid_eob", "2"].join("/;/"),
    ["VOTC:IN", "siblings", "2", "12", "兄长", "他", "408000", "1116年11月1日"].join("/;/"),
    ["VOTC:IN", "sibling_death", "2", "12", "428000", "1171年9月2日", "BATTLE"].join("/;/"),
    ["VOTC:IN", "sibling_eob", "2"].join("/;/")
  ];
}

class CK3LogProductionFixture {
  constructor(data) {
    this.playerID = Number(data[0]);
    this.playerName = data[1];
    this.aiID = Number(data[2]);
    this.aiName = data[3];
    this.date = data[4];
    this.totalDays = Number(data[8]);
    this.characters = new Map();
  }
}

module.exports = { CK3LogProductionFixture, characterLine, productionFamilyLogLines };
