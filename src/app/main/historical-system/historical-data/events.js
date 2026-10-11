"use strict";

const event = (eventKey, displayName, year = null, baselineDynasty = null) => ({
  eventKey,
  displayName,
  date: { year, month: null, day: null },
  baselineDynasty,
  sensitivity: "low"
});

const events = [
  event("huang_chao_rebellion_875_884", "黄巢起义(875-884)", 875, "唐朝"),
  event("changan_fall", "长安陷落", null, "唐朝"),
  event("zhu_wen_usurpation_907", "朱温篡唐(907)", 907, "唐朝"),
  event("later_liang_established", "后梁建立", null, "五代十国"),
  event("later_tang_destroyed_liang", "后唐灭梁", null, "五代十国"),
  event("later_zhou_shizong_reforms", "后周世宗改革", null, "五代十国"),
  event("chenqiao_mutiny", "陈桥兵变", null, "北宋"),
  event("cup_of_wine_releases_generals", "杯酒释兵权", null, "北宋"),
  event("southern_unification", "统一南方", null, "北宋"),
  event("northern_han_destroyed", "灭北汉", null, "北宋"),
  event("gaoliang_river_battle", "高梁河之战", null, "北宋"),
  event("yongxi_northern_expedition", "雍熙北伐", null, "北宋"),
  event("chanyuan_treaty_1004", "澶渊之盟(1004)", 1004, "北宋"),
  event("song_liao_peace", "宋辽议和", null, "北宋"),
  event("empress_liu_regency", "刘太后垂帘听政", null, "北宋"),
  event("empress_guo_deposed", "废郭皇后", null, "北宋"),
  event("qingli_reforms", "庆历新政", null, "北宋"),
  event("song_xia_war", "宋夏战争", null, "北宋"),
  event("xining_reforms", "熙宁变法", null, "北宋"),
  event("new_old_party_strife", "新旧党争", null, "北宋"),
  event("yuanyou_restoration", "元祐更化", null, "北宋"),
  event("empress_gao_regency", "高太后垂帘听政", null, "北宋"),
  event("cai_jing_dominance", "蔡京专权", null, "北宋"),
  event("fang_la_rebellion", "方腊起义", null, "北宋"),
  event("jingkang_incident_eve", "靖康之变前夕", null, "北宋"),
  event("jingkang_incident_1127", "靖康之变(1127)", 1127, "北宋"),
  event("southern_song_established", "南宋建立", null, "南宋"),
  event("song_jin_war", "宋金战争", null, "南宋"),
  event("shaoxing_treaty_1141", "绍兴和议(1141)", 1141, "南宋"),
  event("yue_fei_killed", "岳飞被害", null, "南宋"),
  event("longxing_northern_expedition", "隆兴北伐", null, "南宋"),
  event("qiandao_governance", "乾道之治", null, "南宋"),
  event("kaixi_northern_expedition", "开禧北伐", null, "南宋"),
  event("mongol_western_campaigns", "蒙古西征", null, "南宋"),
  event("song_mongol_destroyed_jin", "宋蒙联合灭金", null, "南宋"),
  event("joint_mongol_jin_1234", "联蒙灭金(1234)", 1234, "南宋"),
  event("diaoyucheng_battle", "钓鱼城之战", null, "南宋"),
  event("xiangyang_defense", "襄阳保卫战", null, "南宋"),
  event("xiangyang_fall_1273", "襄阳陷落(1273)", 1273, "南宋"),
  event("linan_fall_1276", "临安陷落(1276)", 1276, "南宋"),
  event("yamen_battle_eve", "崖山海战前", null, "南宋"),
  event("yamen_battle_1279", "崖山海战(1279)", 1279, "元朝"),
  event("southern_song_fall", "南宋灭亡", null, "元朝"),
  event("yuan_rule", "元朝统治", null, "元朝")
];

module.exports = { events };
