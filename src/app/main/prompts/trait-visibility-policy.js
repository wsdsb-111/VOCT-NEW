"use strict";

const observableAliases = [
  ["beauty_good_1", "Comely", "眉清目秀", "Physique avenant", "Wohlgestalt", "Миловидность", "Guapo", "반반한"],
  ["beauty_good_2", "Attractive", "Handsome", "Pretty", "明眸皓齿", "英姿飒爽", "螓首蛾眉", "Attirant", "Beau", "Jolie", "Anziehend", "Stattlich", "Hübsch", "Привлекательность", "Красавец", "Красотка", "Hermoso", "Hermosa", "매력적인", "잘생긴", "어여쁜"],
  ["beauty_good_3", "Beautiful", "倾国倾城", "Magnifique", "Wunderschön", "Прелесть", "아름다운"],
  ["beauty_bad_1", "Homely", "其貌不扬", "Sans charme", "Reizlos", "Невзрачность", "Feúcho", "못생긴"],
  ["beauty_bad_2", "Ugly", "丑陋不堪", "Laideur", "Hässlich", "Уродство", "Feo", "추한"],
  ["beauty_bad_3", "Hideous", "面目狰狞", "Hideux", "Abscheulich", "Безобразие", "Horroroso", "끔찍한"],
  ["strong", "Strong", "强壮", "Force", "Stark", "Сила", "Fuerte", "강력한"],
  ["weak", "Weak", "虚弱"],
  ["physique_good_1", "Hale", "硬朗", "Vigoureux", "Kerngesund", "Крепкое тело", "Sano", "건강한"],
  ["physique_good_2", "Robust", "健壮", "Robuste", "Сильное тело", "Robusto", "팔팔한"],
  ["physique_good_3", "Divine", "Herculean", "Amazonian", "宛若天神", "海格力斯", "阿玛宗", "Divin", "Herculéen", "Amazone", "Göttlich", "Herkules", "Божественная стать", "Геракл", "Амазонка", "Divino", "Hercúleo", "Amazona", "초인", "대장부", "여장부"],
  ["physique_bad_1", "Delicate", "纤弱", "Délicat", "Zart", "Субтильность", "Delicado", "부실한"],
  ["physique_bad_2", "Frail", "脆弱", "Frêle", "Zierlich", "Хрупкость", "Frágil", "연약한"],
  ["physique_bad_3", "Feeble", "衰弱", "Faible", "Kraftlos", "Хилость", "Flojo", "허약한"],
  ["albino", "Albino", "白化病", "Albinos", "Альбинос", "백색증"],
  ["scaly", "Scaly", "鱼鳞病", "Squameux", "Schuppig", "Псориаз", "Escamoso", "비늘 덮인"],
  ["giant", "Giant", "巨人", "Géant", "Riese", "Гигантизм", "Gigante", "거인"],
  ["dwarf", "Dwarf", "侏儒", "Nain", "Zwerg", "Карликовость", "Enano", "난쟁이"],
  ["hunchbacked", "Hunchbacked", "驼背", "Bossu", "Bucklig", "Горб", "Jorobado", "곱사등이"],
  ["harelip", "Harelip", "兔唇"],
  ["clubfooted", "Club-footed", "足内翻", "Pied bot", "Klumpfüßig", "Косолапие", "Pie deforme", "내반족"],
  ["wheezing", "Wheezing", "哮喘", "Respire bruyamment", "Keucher", "Хрипы", "Jadeante", "쌕쌕거림"],
  ["spindly", "Spindly", "纺锤身形", "Filiforme", "Spindeldürr", "Долговязость", "Larguirucho", "길쭉한"],
  ["one_eyed", "One-eyed", "独眼", "Borgne", "Einäugig", "Один глаз", "Tuerto", "애꾸눈"],
  ["one_legged", "One-legged", "独腿", "Unijambiste", "Einbeinig", "Одна нога", "Cojo", "외다리"],
  ["blind", "Blind", "失明", "Aveugle", "Слепота", "Ciego", "맹인"],
  ["clouded_eyes", "Clouded Eyes", "瞳孔浑浊"],
  ["disfigured", "Disfigured", "毁容", "Défiguré", "Entstellt", "Обезображенное лицо", "Desfigurado", "흉측한"],
  ["scarred", "Scarred", "伤疤", "瘢痕处处", "血肉模糊"],
  ["maimed", "Maimed", "残废", "Mutilé", "Verstümmelt", "Серьезное увечье", "Mutilado", "불구자"],
  ["incapable", "Incapable", "无能", "Untauglich", "Недееспособность", "Incapaz", "불능자"],
  ["wounded_1", "Wounded", "受伤", "Blessé", "Verwundet", "Ранение", "Herido", "부상"],
  ["wounded_2", "Severely Wounded", "Severely Injured", "身受重伤", "重伤", "Blessé gravement", "Schwer verletzt", "Серьезное ранение", "Gravemente herido", "극심한 부상"],
  ["wounded_3", "Brink of Death", "Brutally Mauled", "严重撕裂", "濒死", "Lacéré sauvagement", "Übel zugerichtet", "Жестокие увечья", "Brutalmente vapuleado", "무참한 부상"],
  ["obese", "Obese", "肥胖"],
  ["malnourished", "Malnourished", "营养不良"],
  ["bubonic_plague", "Bubonic Plague", "腺鼠疫", "Peste bubonique", "Pest", "Бубонная чума", "Peste bubónica", "가래톳 흑사병"],
  ["smallpox", "Smallpox", "天花", "Variole", "Blattern", "Оспа", "Viruela", "천연두"],
  ["measles", "Measles", "麻疹"],
  ["leper", "Leper", "Leprosy", "麻风病", "Lèpre", "Aussätziger", "Проказа", "Lepra", "나병"],
  ["consumption", "Consumption", "肺痨", "Consomption", "Schwindsucht", "Чахотка", "Tuberculosis", "폐결핵"],
  ["typhus", "Typhus", "伤寒", "Тиф", "Tifus", "발진티푸스"]
];

const hiddenAliases = [
  ["intellect_good_1", "Quick", "敏锐"], ["intellect_good_2", "Intelligent", "聪慧"], ["intellect_good_3", "Genius", "天才"],
  ["intellect_bad_1", "Slow", "迟钝"], ["intellect_bad_2", "Stupid", "愚笨"], ["intellect_bad_3", "Imbecile", "痴呆"],
  ["pure_blooded", "Pure-blooded", "纯血"], ["fecund", "Fecund", "多产"], ["inbred", "Inbred", "近亲繁殖"],
  ["eunuch", "Eunuch", "阉人"], ["dysentery", "Dysentery", "痢疾"], ["great_pox", "Great Pox", "梅毒"],
  ["gout_ridden", "Gout", "痛风"], ["cancer", "Cancer", "癌症"], ["lunatic", "Lunatic", "精神错乱"],
  ["possessed", "Possessed", "附身"], ["depressed", "Melancholic", "抑郁"], ["sayyid", "Sayyid", "赛义德", "赛义达"],
  ["savior", "Savior", "救主"], ["divine_blood", "Divine Blood", "神性之血"], ["augustus", "Augustus", "奥古斯都"],
  ["conqueror", "Conqueror", "征服者"], ["legitimized_bastard", "Legitimized Bastard", "合法私生子"],
  ["bastard", "Bastard", "私生子"], ["disputed_heritage", "Disputed Heritage", "有争议的血统"], ["reincarnation", "Reincarnation", "转世"],
  ["kinslayer_3", "Familicide", "弑至亲者"], ["kinslayer_2", "Kinslayer", "弑亲族者", "弑亲者"], ["kinslayer_1", "Dynastic Kinslayer", "弑族亲者"],
  ["cannibal", "Cannibal", "食人者"], ["deviant", "Deviant", "变态"], ["witch", "Witch", "巫师"],
  ["incestuous", "Incestuous", "乱伦者"], ["adulterer", "Adulterer", "通奸者"], ["sodomite", "Sodomite", "鸡奸者"],
  ["excommunicated", "Excommunicated", "绝罚"], ["brave", "Brave", "勇敢"], ["craven", "Craven", "怯懦"],
  ["honest", "Honest", "诚实"], ["deceitful", "Deceitful", "狡诈"], ["generous", "Generous", "慷慨"], ["greedy", "Greedy", "贪婪"],
  ["compassionate", "Compassionate", "慈悲"], ["callous", "Callous", "冷酷"], ["sadistic", "Sadistic", "虐待狂"],
  ["diligent", "Diligent", "勤勉"], ["lazy", "Lazy", "懒惰"], ["humble", "Humble", "谦卑"], ["arrogant", "Arrogant", "傲慢"],
  ["forgiving", "Forgiving", "宽宏大量"], ["vengeful", "Vengeful", "睚眦必报"], ["temperate", "Temperate", "节制"],
  ["gluttonous", "Gluttonous", "暴食"], ["chaste", "Chaste", "忠贞"], ["lustful", "Lustful", "色欲"], ["trusting", "Trusting", "轻信他人"],
  ["paranoid", "Paranoid", "多疑"], ["zealous", "Zealous", "狂热"], ["cynical", "Cynical", "愤世嫉俗"], ["content", "Content", "安于现状"],
  ["ambitious", "Ambitious", "野心勃勃"], ["gregarious", "Gregarious", "合群"], ["shy", "Shy", "害羞"], ["calm", "Calm", "冷静"],
  ["wrathful", "Wrathful", "暴怒"], ["stubborn", "Stubborn", "固执"], ["eccentric", "Eccentric", "古怪"], ["just", "Just", "公正"],
  ["arbitrary", "Arbitrary", "专断"], ["diplomat", "Diplomat", "外交家"], ["august", "August", "贵不可言"],
  ["family_first", "Family First", "亲族为先", "顾家之人", "顾家男人", "顾家女人"], ["strategist", "Strategist", "军事家"],
  ["overseer", "Overseer", "监督者"], ["gallant", "Gallant", "侠义骑士"], ["architect", "Architect", "建筑家"],
  ["administrator", "Administrator", "行政家"], ["avaricious", "Avaricious", "爱财如命"], ["schemer", "Schemer", "阴谋家"],
  ["seducer", "Seducer", "勾引者"], ["torturer", "Torturer", "拷打者"], ["whole_of_body", "Whole of Body", "身心俱悉"],
  ["erudite", "Scholar", "博学者"], ["theologian", "Theologian", "神学家"],
  ["lifestyle_blademaster", "Blademaster", "剑术大师", "立志的剑客", "刀剑大师", "传奇剑圣"], ["hunter", "Hunter", "猎人"],
  ["herbalist", "Herbalist", "草药师"], ["mystic", "Mystic", "智者", "女智者", "神秘主义者", "行奇迹者"],
  ["traveler", "Traveler", "旅行者"], ["pilgrim", "Pilgrim", "朝圣者"], ["hajji", "Hajjaj", "Hajji", "朝觐者", "朝觐妇"],
  ["open_terrain_expert", "Open Terrain Expert", "开阔地形专家"], ["rough_terrain_expert", "Rough Terrain Expert", "崎岖地形专家"],
  ["forest_fighter", "Forest Fighter", "森林斗士"], ["forder", "Ford Crosser", "涉水者"], ["siege_engineer", "Siege Engineer", "攻城专家"],
  ["organizer", "Organizer", "组织者"], ["flexible_leader", "Flexible Defender", "灵活的将领"],
  ["unyielding_defender", "Unyielding Defender", "防御者"], ["holy_warrior", "Holy Warrior", "虔信之剑"], ["reckless", "Reckless", "鲁莽"],
  ["drunkard", "Drunkard", "酒鬼"], ["comfort_eater", "Comfort Eater", "食以慰藉"], ["profligate", "Profligate", "挥霍"],
  ["hashishiyah", "Hashishiyah", "大麻瘾君子"], ["rakish", "Rake", "放荡"], ["flagellant", "Flagellant", "自鞭笞者"],
  ["reclusive", "Reclusive", "蛰居"], ["inappetetic", "Inappetetic", "食欲不振"], ["athletic", "Athletic", "健身"],
  ["journaller", "Journaller", "写日记者"], ["confider", "Confider", "倾诉者"]
];

const normalizeAlias = value => String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/^trait[_\s-]/, "").replace(/[\s_-]+/g, "");
const normalizeCanonicalId = value => String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/^trait[_\s-]/, "");
const aliases = new Map();
const canonicalAliases = new Map();
for (const row of [...observableAliases, ...hiddenAliases]) {
  canonicalAliases.set(normalizeCanonicalId(row[0]), row[0]);
  for (const name of row) aliases.set(normalizeAlias(name), row[0]);
}
for (const [variant, key] of [["beauty_good_male_2", "beauty_good_2"], ["beauty_good_female_2", "beauty_good_2"],
  ["physique_good_male_3", "physique_good_3"], ["physique_good_female_3", "physique_good_3"]]) {
  canonicalAliases.set(normalizeCanonicalId(variant), key);
  aliases.set(normalizeAlias(variant), key);
}

const NON_OBSERVABLE_TO_OTHERS = new Set(hiddenAliases.map(row => row[0]));
const OBSERVABLE_TO_OTHERS = new Set(observableAliases.map(row => row[0]));
const NON_OBSERVABLE_CATEGORY = /personality|lifestyle|activity|activities|commander|stress|coping|secret|reputation|bloodline|intellect|hidden[-_ ]?health|性格|人格|生活方式|活动|指挥|将领|压力|应激|秘密|声望|血统|智力|persönlichkeit|lebenswandel|kommandant|personnalité|mode de vie|commandant|personalidad|estilo de vida|comandante|личност|образ жизни|полковод|성격|생활 방식|지휘관|osobowo|dowódc|性格|ライフスタイル|指揮官/i;
const OBSERVABLE_CATEGORY = /^(?:appearance(?: traits?)?|visible appearance|physical-visible|injury-visible|deformity-visible|visible-disease|外貌(?:特质)?|外觀(?:特質)?|外观(?:特质)?|外見(?:特性)?|внешност[ьи]?|외모(?: 특성)?)$/i;

function rawIdentity(trait) {
  if (typeof trait === "string") return trait;
  return trait?.traitId ?? trait?.key ?? trait?.id;
}

function normalizeTraitKey(trait) {
  const identity = rawIdentity(trait);
  if (identity !== undefined && identity !== null && String(identity).trim()) {
    const canonicalKey = canonicalAliases.get(normalizeCanonicalId(identity)) || aliases.get(normalizeAlias(identity));
    if (canonicalKey) return canonicalKey;
    if (typeof trait === "string") return aliases.get(normalizeAlias(trait)) || normalizeCanonicalId(trait);
    return normalizeCanonicalId(identity);
  }
  const label = typeof trait === "string" ? trait : trait?.name ?? trait?.localizedName;
  const normalized = normalizeAlias(label);
  return aliases.get(normalized) || normalized;
}

function getTraitAliases(trait) {
  const key = normalizeTraitKey(trait);
  return [...new Set([typeof trait === "string" ? trait : trait?.name, trait?.localizedName,
    trait?.traitId, trait?.key, trait?.id, ...(observableAliases.find(row => row[0] === key)
      || hiddenAliases.find(row => row[0] === key) || [])]
    .filter(value => typeof value === "string" && value.trim()))];
}

function resolveTraitVisibility(trait) {
  const identity = rawIdentity(trait);
  const identityKey = identity === undefined || identity === null ? "" : normalizeCanonicalId(identity);
  const canonicalKey = normalizeTraitKey(trait);
  const identityAlias = identityKey && (canonicalAliases.get(identityKey) || aliases.get(normalizeAlias(identity)));
  if (identityAlias) {
    const key = identityAlias;
    if (OBSERVABLE_TO_OTHERS.has(key)) return { status: "OBSERVABLE", canonicalKey: key, reason: "CANONICAL_ID" };
    if (NON_OBSERVABLE_TO_OTHERS.has(key)) return { status: "NON_OBSERVABLE", canonicalKey: key, reason: "CANONICAL_ID" };
  }

  const category = String(trait?.category ?? "").normalize("NFKC").trim().replace(/[_-]+/g, "-");
  if (category && OBSERVABLE_CATEGORY.test(category)) {
    return { status: "OBSERVABLE", canonicalKey, reason: "CATEGORY_APPEARANCE" };
  }
  if (category && NON_OBSERVABLE_CATEGORY.test(category)) {
    return { status: "NON_OBSERVABLE", canonicalKey, reason: "CATEGORY_NON_OBSERVABLE" };
  }

  const labels = typeof trait === "string" ? [trait] : [trait?.name, trait?.localizedName];
  for (const label of labels) {
    const key = aliases.get(normalizeAlias(label));
    if (key && OBSERVABLE_TO_OTHERS.has(key)) return { status: "OBSERVABLE", canonicalKey, reason: "LOCALIZED_ALIAS" };
    if (key && NON_OBSERVABLE_TO_OTHERS.has(key)) return { status: "NON_OBSERVABLE", canonicalKey, reason: "LOCALIZED_ALIAS" };
  }
  return { status: "UNKNOWN", canonicalKey, reason: "UNRESOLVED" };
}

module.exports = { NON_OBSERVABLE_TO_OTHERS, OBSERVABLE_TO_OTHERS, normalizeTraitKey, getTraitAliases, resolveTraitVisibility };
