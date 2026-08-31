"use strict";

// Frozen v7.10.1 implementation. This fixture must stay independent from the
// V8 baseline so parity cannot pass by comparing the new source to itself.
function getFrozenLegacyReferenceByYear(year) {
  if (year >= 875 && year < 907) {
    return { period: "唐末黄巢起义至唐朝灭亡", context: "黄巢起义动摇唐朝根基，藩镇割据严重，天下大乱", notableEvents: ["黄巢起义(875-884)", "长安陷落", "朱温篡唐(907)"], notableFigures: ["黄巢", "朱温", "李克用", "李茂贞"] };
  } else if (year >= 907 && year < 960) {
    return { period: "五代十国", context: "中原五代更迭，南方十国并立，战乱频仍", notableEvents: ["后梁建立", "后唐灭梁", "后周世宗改革"], notableFigures: ["朱温", "李存勖", "石敬瑭", "柴荣", "赵匡胤"] };
  } else if (year >= 960 && year < 976) {
    return { period: "北宋开国", context: "宋朝开国，结束五代十国乱世，中央集权初步建立", notableEvents: ["陈桥兵变", "杯酒释兵权", "统一南方"], notableFigures: ["赵普", "石守信", "王全斌"] };
  } else if (year >= 976 && year < 1000) {
    return { period: "北宋统一战争", context: "继续统一战争，强化中央集权，重文轻武政策形成", notableEvents: ["灭北汉", "高梁河之战", "雍熙北伐"], notableFigures: ["赵普", "潘美", "杨业"] };
  } else if (year >= 1000 && year < 1022) {
    return { period: "咸平景德年间", context: "辽宋对峙，澶渊之盟签订", notableEvents: ["澶渊之盟(1004)", "宋辽议和"], notableFigures: ["寇准", "王钦若", "毕士安"] };
  } else if (year >= 1022 && year < 1050) {
    return { period: "仁宗前期", context: "仁宗亲政初期，士大夫势力增强", notableEvents: ["刘太后垂帘听政", "废郭皇后"], notableFigures: ["范仲淹", "欧阳修", "韩琦"] };
  } else if (year >= 1050 && year < 1063) {
    return { period: "仁宗后期", context: "庆历新政后，辽夏压力增加", notableEvents: ["庆历新政", "宋夏战争"], notableFigures: ["范仲淹", "富弼", "欧阳修", "司马光"] };
  } else if (year >= 1063 && year < 1085) {
    return { period: "熙宁变法", context: "王安石变法，改革派与保守派斗争激烈", notableEvents: ["熙宁变法", "新旧党争"], notableFigures: ["王安石", "司马光", "苏轼", "苏辙"] };
  } else if (year >= 1085 && year < 1100) {
    return { period: "元祐更化", context: "废除新法，保守派当政", notableEvents: ["元祐更化", "高太后垂帘听政"], notableFigures: ["司马光", "苏轼", "苏辙", "程颐"] };
  } else if (year >= 1100 && year < 1126) {
    return { period: "北宋末期", context: "政治腐败，金国崛起，北宋危机", notableEvents: ["蔡京专权", "方腊起义", "靖康之变前夕"], notableFigures: ["蔡京", "童贯", "李纲", "种师道"] };
  } else if (year >= 1126 && year < 1142) {
    return { period: "靖康之变与南宋建立", context: "金兵南下，徽钦二帝被俘，康王赵构南渡建立南宋", notableEvents: ["靖康之变(1127)", "南宋建立", "宋金战争"], notableFigures: ["岳飞", "韩世忠", "宗泽", "李纲", "秦桧"] };
  } else if (year >= 1142 && year < 1162) {
    return { period: "绍兴议和", context: "绍兴和议后，宋金对峙局面形成", notableEvents: ["绍兴和议(1141)", "岳飞被害"], notableFigures: ["秦桧", "岳飞", "韩世忠", "张俊"] };
  } else if (year >= 1162 && year < 1189) {
    return { period: "孝宗中兴", context: "孝宗力图恢复，经济文化发展", notableEvents: ["隆兴北伐", "乾道之治"], notableFigures: ["虞允文", "张浚", "辛弃疾", "陆游"] };
  } else if (year >= 1189 && year < 1234) {
    return { period: "南宋中期", context: "宋金对峙，蒙古崛起改变局势", notableEvents: ["开禧北伐", "蒙古西征", "宋蒙联合灭金"], notableFigures: ["韩侂胄", "史弥远", "辛弃疾", "陆游"] };
  } else if (year >= 1234 && year < 1260) {
    return { period: "宋蒙战争前期", context: "金国灭亡，宋蒙关系破裂，襄樊鏖战", notableEvents: ["联蒙灭金(1234)", "钓鱼城之战", "襄阳保卫战"], notableFigures: ["孟珙", "余玠", "贾似道"] };
  } else if (year >= 1260 && year < 1279) {
    return { period: "南宋末期", context: "蒙古铁骑南下，南宋危在旦夕", notableEvents: ["襄阳陷落(1273)", "临安陷落(1276)", "崖山海战前"], notableFigures: ["文天祥", "张世杰", "陆秀夫", "贾似道"] };
  } else if (year >= 1279) {
    return { period: "元朝建立", context: "崖山海战后，南宋灭亡，蒙元统治中原", notableEvents: ["崖山海战(1279)", "南宋灭亡", "元朝统治"], notableFigures: ["忽必烈", "伯颜", "文天祥"] };
  }
  return { period: "唐朝时期", context: "大唐帝国，文治武功鼎盛", notableEvents: [], notableFigures: [] };
}

module.exports = { getFrozenLegacyReferenceByYear };
