"use strict";

function familyCharacters() {
  return {
    "1": { id: "1", firstName: "甲", gender: "male", birth: "1150.1.1", alive: true, parents: { father: "2", mother: "3" }, spouse: "13" },
    "2": { id: "2", firstName: "父", gender: "male", parents: { father: "5", mother: "6" }, children: ["1", "4"] },
    "3": { id: "3", firstName: "母", gender: "female", parents: { father: "7", mother: "8" }, children: ["1", "4"] },
    "4": { id: "4", firstName: "妹", gender: "female", parents: { father: "2", mother: "3" } },
    "5": { id: "5", firstName: "祖父", gender: "male", children: ["2", "9"] },
    "6": { id: "6", firstName: "祖母", gender: "female", children: ["2", "9"] },
    "7": { id: "7", firstName: "外祖父", gender: "male", children: ["3", "11"] },
    "8": { id: "8", firstName: "外祖母", gender: "female", children: ["3", "11"] },
    "9": { id: "9", firstName: "叔伯", gender: "male", parents: { father: "5", mother: "6" }, children: ["10"] },
    "10": { id: "10", firstName: "堂亲", gender: "male", parents: { father: "9" } },
    "11": { id: "11", firstName: "姨母", gender: "female", parents: { father: "7", mother: "8" }, children: ["12"] },
    "12": { id: "12", firstName: "表亲", gender: "female", parents: { mother: "11" } },
    "13": { id: "13", firstName: "亡妻", gender: "female", alive: false, birth: "1148.1.1", deathDate: "1170.2.1" }
  };
}

function evidenceMemory(overrides = {}) {
  return {
    memoryId: "evidence-1",
    type: "promise",
    subjects: [3],
    participants: [2, 3],
    content: "韩世忠明确答应下月赴临安商议此事。\n\n【需要长期记住的事项】韩世忠承诺下月赴约。",
    canonicalText: "韩世忠承诺下月赴约",
    tags: ["韩世忠", "承诺"],
    importance: 0.9,
    confidence: 1,
    source: "witnessed",
    epistemicStatus: "asserted",
    eventDate: "1170.5.1",
    totalDays: 420000,
    provenance: { counterpartIds: [3] },
    ...overrides
  };
}

module.exports = { evidenceMemory, familyCharacters };
