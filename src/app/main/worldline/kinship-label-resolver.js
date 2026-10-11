"use strict";

function resolveKinshipLabel({ type, sex = "unknown", branch = null, seniority = null } = {}) {
  const male = sex === "male";
  const female = sex === "female";
  if (type === "PARENT_OF") return male ? "父亲" : female ? "母亲" : "父母";
  if (type === "CHILD_OF") return male ? "儿子" : female ? "女儿" : "子女";
  if (type === "SIBLING_OF") return male ? "兄弟" : female ? "姐妹" : "兄弟姐妹";
  if (type === "GRANDPARENT_OF") return branch === "PATERNAL" ? male ? "祖父" : female ? "祖母" : "祖辈亲属" : branch === "MATERNAL" ? male ? "外祖父" : female ? "外祖母" : "祖辈亲属" : "祖辈亲属";
  if (type === "GRANDCHILD_OF") return male ? "孙辈男亲" : female ? "孙辈女亲" : "孙辈";
  if (type === "AUNT_UNCLE_OF") return branch === "PATERNAL" ? male ? seniority > 0 ? "伯父" : seniority < 0 ? "叔父" : "叔伯" : female ? "姑母" : "父系叔伯姑" : branch === "MATERNAL" ? male ? "舅父" : female ? "姨母" : "母系舅姨" : "叔伯辈亲属";
  if (type === "NIECE_NEPHEW_OF") return "晚辈近亲";
  if (type === "COUSIN_OF") {
    const prefix = branch === "PATERNAL_MALE" ? "堂" : ["PATERNAL_FEMALE", "MATERNAL"].includes(branch) ? "表" : "堂表";
    return prefix + (prefix !== "堂表" && (male || female) && seniority ? seniority > 0 ? male ? "哥" : "姐" : male ? "弟" : "妹" : "亲");
  }
  if (type === "SPOUSE_OF") return male ? "丈夫" : female ? "妻子" : "配偶";
  if (type === "FORMER_SPOUSE_OF") return male ? "前夫" : female ? "前妻" : "前配偶";
  if (type === "DECEASED_SPOUSE_OF") return male ? "亡夫" : female ? "亡妻" : "已故配偶";
  return "近亲";
}

module.exports = { resolveKinshipLabel };
