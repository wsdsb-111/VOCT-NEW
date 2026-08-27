"use strict";

const ENTRIES = Object.freeze([
  ["makeAlliance", "双方正式缔结军事同盟", ["从今日起我们正式结盟", "双方击掌盟誓，结成同盟"], ["你愿意结盟吗", "以后或许可以结盟"]],
  ["agreedToTruceWith", "双方正式达成停战", ["我们同意休战三年", "双方签订了停战协议"], ["是否愿意停战", "他回忆起往日的休战"]],
  ["becomeLoversWith", "双方正式成为情人", ["从今日起你我便是恋人", "二人互许终身，正式定情"], ["我喜欢你", "你愿意做我的恋人吗"]],
  ["becomeFriendsWith", "双方正式成为朋友", ["从今往后我们便是朋友", "二人正式结为好友"], ["我想和你做朋友", "他看起来很友善"]],
  ["becomeBestFriendsWith", "双方正式成为挚友", ["你我从此便是挚友", "二人结为至交"], ["我们是朋友", "愿意成为挚友吗"]],
  ["becomeSoulmatesWith", "双方正式成为灵魂伴侣", ["你我从此便是灵魂伴侣", "二人认定彼此为命定之人"], ["我爱你", "也许你是命定之人"]],
  ["becomeBloodBrothersWith", "双方正式结拜", ["二人歃血为盟，结为义兄弟", "今日你我正式结拜"], ["愿与我结拜吗", "他提起曾经结拜"]],
  ["paysGoldTo", "NPC 已实际向目标支付金币", ["我已经付给你一百金币", "他把五十金币交到对方手中"], ["愿意给我一百金币吗", "我以后会付钱"]],
  ["changeOpinionOf", "角色对目标的长期态度发生明确变化", ["我对你刮目相看，愈发信任", "她对他心生厌恶，不再信任"], ["她笑了", "他一时有些生气"]],
  ["setEmotion", "角色呈现明确可见姿态", ["她轻笑了一声", "他跪下祈祷"], ["她神色复杂", "他似乎心情不好"]],
  ["changeLocation", "角色已经移动到明确地点", ["他离开大厅来到花园", "她已经返回寝宫"], ["他打算去花园", "请你去大厅"]],
  ["leavesConversation", "角色已经退出当前对话", ["他转身离开了谈话", "她告辞并退出房间"], ["我稍后再走", "你应该离开"]],
  ["isEmployedBy", "角色已被目标正式雇佣", ["领主正式将他招入宫廷", "她接受任命并受雇于公爵"], ["你愿意为我效力吗", "他希望得到任用"]]
].map(([actionId, meaning, positive, negative]) => Object.freeze({ actionId, meaning, positive: Object.freeze(positive), negative: Object.freeze(negative) })));

function forAction(actionId) {
  return ENTRIES.find((entry) => entry.actionId === actionId) || null;
}

module.exports = { ENTRIES, forAction };
