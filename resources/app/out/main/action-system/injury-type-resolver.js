"use strict";
function resolve(evidenceText) {
  const source = typeof evidenceText === "string" ? evidenceText : "";
  if (!source.trim()) return { resolved: false, injuryType: null, reason: "injury_argument_unresolved" };
  if (/(?:双眼|双目).{0,8}(?:失明|刺瞎|打瞎|弄瞎)|(?:刺瞎|打瞎|弄瞎).{0,8}(?:双眼|双目)|blinded/i.test(source)) {
    return { resolved: true, injuryType: "blind", reason: "explicit_bilateral_blindness" };
  }
  if (/(?:剜掉|剜出|毁掉|刺瞎|打瞎|弄瞎).{0,8}(?:一只|一枚|左|右)?眼|(?:一只|一枚|左|右)眼.{0,8}(?:被)?(?:剜掉|剜出|毁掉|刺瞎|打瞎|弄瞎)/i.test(source)) {
    return { resolved: true, injuryType: "remove_eye", reason: "explicit_single_eye_loss" };
  }
  if (/(?:砍断|斩断|砍下|斩下|割下).{0,8}(?:左腿|右腿|一条腿|腿)|(?:左腿|右腿|一条腿|腿).{0,8}(?:被)?(?:砍断|斩断|砍下|斩下|割下)/i.test(source)) {
    return { resolved: true, injuryType: "cut_leg", reason: "explicit_leg_loss" };
  }
  if (/(?:阉割|去势|宫刑|割去.{0,6}(?:阳具|睾丸)|castrat)/i.test(source)) {
    return { resolved: true, injuryType: "cut_balls", reason: "explicit_castration" };
  }
  if (/(?:毁容|面容尽毁|容貌尽毁|disfigur)/i.test(source)) {
    return { resolved: true, injuryType: "disfigured", reason: "explicit_disfigurement" };
  }
  return { resolved: true, injuryType: "wounded", reason: "completed_generic_injury" };
}
module.exports = { resolve };
