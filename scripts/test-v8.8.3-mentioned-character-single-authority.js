"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { resolveRelationshipCurrentTruth } = require("../resources/app/out/main/worldline/relationship-current-truth");

const player = { id: 1, shortName: "玩家", fullName: "玩家", gender: "male", siblings: [{ id: 162251, name: "赵永和", gender: "female" }], evidence: { relations: [{ ownerId: 162251, relationType: "sibling", source: "runtime" }] } };
const yonghe = { id: 162251, shortName: "赵永和", fullName: "赵永和", gender: "male", age: 6, siblings: [{ id: 1, name: "玩家", gender: "male" }], evidence: { relations: [{ ownerId: 1, relationType: "sibling", source: "runtime" }] } };
const gameData = { characters: new Map([[1, player], [162251, yonghe]]), totalDays: 420000, date: "1170.1.1" };
const registry = new Map();
const fact = resolveRelationshipCurrentTruth({ gameData, subjectRuntimeId: yonghe.id, anchorRuntimeId: player.id, registry });
assert.strictEqual(fact.currentState.sex, "male");
assert.strictEqual(fact.evidence.sexSource, "CURRENT_RUNTIME");
assert.strictEqual(fact.evidence.memoryUsedForCurrentSex, false);
assert(fact.evidence.conflicts.includes("RELATION_SIDE_GENDER_CONFLICT"));
assert(!["姐姐", "妹妹", "她"].includes(fact.relations["1"].label));
assert.strictEqual(registry.get(String(yonghe.id)), fact);
const gameDataSource = fs.readFileSync(path.join(__dirname, "..", "resources", "app", "out", "main", "game-data", "game-data.js"), "utf8");
const promptBuilderSource = fs.readFileSync(path.join(__dirname, "..", "resources", "app", "out", "main", "prompts", "prompt-builder.js"), "utf8");
assert(gameDataSource.includes("resolveRelationshipCurrentTruth"), "mentioned character context must consume the shared current-truth DTO");
assert(promptBuilderSource.includes("currentFactRegistry"), "PromptBuilder must share a current-fact registry between family and mentioned context");
console.log("VOTC v8.8.3 mentioned character single authority fixtures: PASS");
