"use strict";

const periods = [
  {
    key: "tang_before_875",
    startYear: null,
    endYearExclusive: 875,
    baselineDynasty: "唐朝",
    period: "唐朝时期",
    context: "大唐帝国，文治武功鼎盛",
    notableEventKeys: [],
    notableFigureKeys: [],
    expectedRulerKey: null
  },
  {
    key: "late_tang_875_907",
    startYear: 875,
    endYearExclusive: 907,
    baselineDynasty: "唐朝",
    period: "唐末黄巢起义至唐朝灭亡",
    context: "黄巢起义动摇唐朝根基，藩镇割据严重，天下大乱",
    notableEventKeys: ["huang_chao_rebellion_875_884", "changan_fall", "zhu_wen_usurpation_907"],
    notableFigureKeys: ["huang_chao", "zhu_wen", "li_keyong", "li_maozhen"],
    expectedRulerKey: null
  },
  {
    key: "five_dynasties_907_960",
    startYear: 907,
    endYearExclusive: 960,
    baselineDynasty: "五代十国",
    period: "五代十国",
    context: "中原五代更迭，南方十国并立，战乱频仍",
    notableEventKeys: ["later_liang_established", "later_tang_destroyed_liang", "later_zhou_shizong_reforms"],
    notableFigureKeys: ["zhu_wen", "li_cunxu", "shi_jingtang", "chai_rong", "zhao_kuangyin"],
    expectedRulerKey: null
  },
  {
    key: "northern_song_foundation_960_976",
    startYear: 960,
    endYearExclusive: 976,
    baselineDynasty: "北宋",
    period: "北宋开国",
    context: "宋朝开国，结束五代十国乱世，中央集权初步建立",
    notableEventKeys: ["chenqiao_mutiny", "cup_of_wine_releases_generals", "southern_unification"],
    notableFigureKeys: ["zhao_pu", "shi_shouxin", "wang_quanbin"],
    expectedRulerKey: null
  },
  {
    key: "northern_song_unification_976_1000",
    startYear: 976,
    endYearExclusive: 1000,
    baselineDynasty: "北宋",
    period: "北宋统一战争",
    context: "继续统一战争，强化中央集权，重文轻武政策形成",
    notableEventKeys: ["northern_han_destroyed", "gaoliang_river_battle", "yongxi_northern_expedition"],
    notableFigureKeys: ["zhao_pu", "pan_mei", "yang_ye"],
    expectedRulerKey: null
  },
  {
    key: "xianping_jingde_1000_1022",
    startYear: 1000,
    endYearExclusive: 1022,
    baselineDynasty: "北宋",
    period: "咸平景德年间",
    context: "辽宋对峙，澶渊之盟签订",
    notableEventKeys: ["chanyuan_treaty_1004", "song_liao_peace"],
    notableFigureKeys: ["kou_zhun", "wang_qinruo", "bi_shian"],
    expectedRulerKey: null
  },
  {
    key: "renzong_early_1022_1050",
    startYear: 1022,
    endYearExclusive: 1050,
    baselineDynasty: "北宋",
    period: "仁宗前期",
    context: "仁宗亲政初期，士大夫势力增强",
    notableEventKeys: ["empress_liu_regency", "empress_guo_deposed"],
    notableFigureKeys: ["fan_zhongyan", "ouyang_xiu", "han_qi"],
    expectedRulerKey: null
  },
  {
    key: "renzong_late_1050_1063",
    startYear: 1050,
    endYearExclusive: 1063,
    baselineDynasty: "北宋",
    period: "仁宗后期",
    context: "庆历新政后，辽夏压力增加",
    notableEventKeys: ["qingli_reforms", "song_xia_war"],
    notableFigureKeys: ["fan_zhongyan", "fu_bi", "ouyang_xiu", "sima_guang"],
    expectedRulerKey: null
  },
  {
    key: "xining_reforms_1063_1085",
    startYear: 1063,
    endYearExclusive: 1085,
    baselineDynasty: "北宋",
    period: "熙宁变法",
    context: "王安石变法，改革派与保守派斗争激烈",
    notableEventKeys: ["xining_reforms", "new_old_party_strife"],
    notableFigureKeys: ["wang_anshi", "sima_guang", "su_shi", "su_zhe"],
    expectedRulerKey: null
  },
  {
    key: "yuanyou_restoration_1085_1100",
    startYear: 1085,
    endYearExclusive: 1100,
    baselineDynasty: "北宋",
    period: "元祐更化",
    context: "废除新法，保守派当政",
    notableEventKeys: ["yuanyou_restoration", "empress_gao_regency"],
    notableFigureKeys: ["sima_guang", "su_shi", "su_zhe", "cheng_yi"],
    expectedRulerKey: null
  },
  {
    key: "late_northern_song_1100_1126",
    startYear: 1100,
    endYearExclusive: 1126,
    baselineDynasty: "北宋",
    period: "北宋末期",
    context: "政治腐败，金国崛起，北宋危机",
    notableEventKeys: ["cai_jing_dominance", "fang_la_rebellion", "jingkang_incident_eve"],
    notableFigureKeys: ["cai_jing", "tong_guan", "li_gang", "zhong_shidao"],
    expectedRulerKey: null
  },
  {
    key: "jingkang_southern_song_foundation_1126_1142",
    startYear: 1126,
    endYearExclusive: 1142,
    baselineDynasty: "北宋至南宋",
    period: "靖康之变与南宋建立",
    context: "金兵南下，徽钦二帝被俘，康王赵构南渡建立南宋",
    notableEventKeys: ["jingkang_incident_1127", "southern_song_established", "song_jin_war"],
    notableFigureKeys: ["yue_fei", "han_shizhong", "zong_ze", "li_gang", "qin_hui"],
    expectedRulerKey: null
  },
  {
    key: "shaoxing_peace_1142_1162",
    startYear: 1142,
    endYearExclusive: 1162,
    baselineDynasty: "南宋",
    period: "绍兴议和",
    context: "绍兴和议后，宋金对峙局面形成",
    notableEventKeys: ["shaoxing_treaty_1141", "yue_fei_killed"],
    notableFigureKeys: ["qin_hui", "yue_fei", "han_shizhong", "zhang_jun"],
    expectedRulerKey: null
  },
  {
    key: "xiaozong_restoration_1162_1189",
    startYear: 1162,
    endYearExclusive: 1189,
    baselineDynasty: "南宋",
    period: "孝宗中兴",
    context: "孝宗力图恢复，经济文化发展",
    notableEventKeys: ["longxing_northern_expedition", "qiandao_governance"],
    notableFigureKeys: ["yu_yunwen", "zhang_jun_zhang", "xin_qiji", "lu_you"],
    expectedRulerKey: null
  },
  {
    key: "middle_southern_song_1189_1234",
    startYear: 1189,
    endYearExclusive: 1234,
    baselineDynasty: "南宋",
    period: "南宋中期",
    context: "宋金对峙，蒙古崛起改变局势",
    notableEventKeys: ["kaixi_northern_expedition", "mongol_western_campaigns", "song_mongol_destroyed_jin"],
    notableFigureKeys: ["han_tuozhou", "shi_miyuan", "xin_qiji", "lu_you"],
    expectedRulerKey: null
  },
  {
    key: "early_song_mongol_war_1234_1260",
    startYear: 1234,
    endYearExclusive: 1260,
    baselineDynasty: "南宋",
    period: "宋蒙战争前期",
    context: "金国灭亡，宋蒙关系破裂，襄樊鏖战",
    notableEventKeys: ["joint_mongol_jin_1234", "diaoyucheng_battle", "xiangyang_defense"],
    notableFigureKeys: ["meng_gong", "yu_jie", "jia_sidao"],
    expectedRulerKey: null
  },
  {
    key: "late_southern_song_1260_1279",
    startYear: 1260,
    endYearExclusive: 1279,
    baselineDynasty: "南宋",
    period: "南宋末期",
    context: "蒙古铁骑南下，南宋危在旦夕",
    notableEventKeys: ["xiangyang_fall_1273", "linan_fall_1276", "yamen_battle_eve"],
    notableFigureKeys: ["wen_tianxiang", "zhang_shijie", "lu_xiufu", "jia_sidao"],
    expectedRulerKey: null
  },
  {
    key: "yuan_foundation_1279_onward",
    startYear: 1279,
    endYearExclusive: null,
    baselineDynasty: "元朝",
    period: "元朝建立",
    context: "崖山海战后，南宋灭亡，蒙元统治中原",
    notableEventKeys: ["yamen_battle_1279", "southern_song_fall", "yuan_rule"],
    notableFigureKeys: ["kublai_khan", "bayan", "wen_tianxiang"],
    expectedRulerKey: null
  }
];

module.exports = { periods };
