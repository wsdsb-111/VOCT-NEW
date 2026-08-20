const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const zod = require(path.join(root, "resources", "app", "node_modules", "zod"));
const mainPath = path.join(root, "resources", "app", "out", "main", "main.js");
const source = fs.readFileSync(mainPath, "utf8");
const modules = require(path.join(root, "resources", "app", "out", "main", "action-system"));
for (const name of ["ConversationReferenceContext", "ReferenceResolver", "ParticipantResolver", "riskPolicy", "invocationValidator", "actionExecutor", "eventTracker", "candidateGate", "eventParser", "semanticResolver", "availabilityService"]) {
  assert(modules[name], `${name} must be exported by the v6.7 action-system module`);
}
for (const filename of ["action-types.js", "candidate-gate.js", "event-parser.js", "semantic-resolver.js", "reference-context.js", "reference-resolver.js", "participant-resolver.js", "availability-service.js", "risk-policy.js", "invocation-validator.js", "action-executor.js", "event-tracker.js"]) {
  assert(fs.existsSync(path.join(root, "resources", "app", "out", "main", "action-system", filename)), `${filename} must remain an independent module`);
}
assert(source.includes('require("./action-system")'), "main runtime must load the v6.7 action-system façade");
assert(source.includes("ParticipantResolver.resolve"), "ActionEngine must delegate participant resolution to the module");
assert(source.includes("candidateGate.detect"), "ActionEngine façade must delegate candidate detection to the module");
assert(source.includes("eventParser.parse"), "ActionEngine façade must delegate event parsing to the module");
assert(source.includes("semanticResolver.resolve"), "ActionEngine façade must delegate semantic resolution to the module");
assert(source.includes("availabilityService.buildAvailableAction"), "ActionEngine must use the isolated availability service");
assert(source.includes("invocationValidator.validateInvocation"), "ActionEngine must validate bound invocations before approval or execution");
assert(source.includes("actionExecutor.execute"), "ActionEngine must use the isolated executor");
assert(source.includes("riskPolicy.getEffectiveRiskLevel"), "ActionRegistry must use the isolated risk policy");

const schemaStart = source.indexOf("function buildStructuredResponseJsonSchema(");
const schemaEnd = source.indexOf("\nclass RunFileManager", schemaStart);
assert(schemaStart >= 0 && schemaEnd > schemaStart, "unable to extract action response schema builders");
eval(source.slice(schemaStart, schemaEnd));
const availableActions = [{ signature: "isInjured", args: [], requiresTarget: true, validTargetCharacterIds: [2], targetLocked: true }];
const jsonSchema = buildStructuredResponseJsonSchema({ availableActions, maxActions: 1 }, false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(jsonSchema.properties.actions.items.anyOf[0].properties, "targetCharacterId"), false, "locked target must be omitted from the strict JSON schema");
const compactSchema = buildGeminiCompatibleSchema({ availableActions, maxActions: 1 });
assert.strictEqual(Object.prototype.hasOwnProperty.call(compactSchema.properties.actions.items.properties, "targetCharacterId"), false, "locked target must be omitted from the compact schema");
const responseSchema = buildStructuredResponseSchema({ availableActions, maxActions: 1 });
assert.deepStrictEqual(responseSchema.parse({ actions: [{ actionId: "isInjured", args: {} }] }).actions[0], { actionId: "isInjured", args: {} }, "locked target output must validate without a model target field");
assert.throws(() => responseSchema.parse({ actions: [{ actionId: "isInjured", targetCharacterId: 2, args: {} }] }), "locked target output must reject a model target field");

const metadataAction = {
  id: "metadataInjury",
  definition: {
    triggerCategories: ["death_or_injury"],
    semantic: { evidencePatterns: [/刺伤/], exclusiveGroup: "harm", priority: 2 }
  }
};
assert.deepStrictEqual(modules.semanticResolver.resolveMetadataCandidates({ category: "death_or_injury", evidence: { text: "我刺伤了他。" } }, { getAllActions: () => [metadataAction] }), ["metadataInjury"], "semantic module must independently shortlist metadata actions");
assert.deepStrictEqual(modules.availabilityService.buildAvailableAction({ action: metadataAction, args: [], checkResult: { requiresTarget: true, validTargetCharacterIds: [2] }, sourceCharacter: { id: 1, shortName: "玩家" }, targetCharacter: { id: 2 }, description: "test", binding: { mode: "resolved" } }).validTargetCharacterIds, [2], "availability module must preserve target constraints");

console.log("VOTC v6.7 modules: PASS (module boundaries and locked-target schema)");
