"use strict";

const { actionMetadata, CATALOG_VERSION, isParticipantOverrideArgument, isValidTargetPolicy, targetAllowed } = require("./master-action-dictionary");
const relevantStateProjector = require("./relevant-state-projector");

function sourceAllowed(requirements, source, gameData) {
  if (requirements.source === "player") return Number(source.id) === Number(gameData.playerID);
  if (requirements.source === "non_player") return Number(source.id) !== Number(gameData.playerID);
  return true;
}

function localize(value, language, resolveI18nString) {
  return typeof resolveI18nString === "function" ? resolveI18nString(value, language) : typeof value === "string" ? value : value?.[language] || value?.en || "";
}

function resolveArguments(definition, context, language, resolveI18nString) {
  const args = typeof definition.args === "function" ? definition.args(context) : definition.args;
  return (args || []).filter((arg) => !isParticipantOverrideArgument(arg.name)).map((arg) => Object.freeze({
    ...arg,
    description: localize(arg.description, language, resolveI18nString)
  }));
}

async function build({ conversation, speaker, registry, language, resolveI18nString }) {
  const state = relevantStateProjector.project(conversation, speaker);
  const participants = state.participants.map((item) => conversation.gameData.characters.get(item.id)).filter(Boolean);
  const participantIds = new Set(participants.map((character) => Number(character.id)));
  const entries = [];
  const actions = registry.getAllActions(false).slice().sort((left, right) => left.id.localeCompare(right.id));
  for (const loaded of actions) {
    const metadata = actionMetadata(loaded);
    if (!metadata.selectorVisible) continue;
    if (!isValidTargetPolicy(metadata.targetPolicy)) {
      registry.registerValidation?.(loaded.id, { valid: false, message: `unknown targetPolicy: ${String(metadata.targetPolicy)}` });
      continue;
    }
    for (const sourceCharacter of participants) {
      if (!sourceAllowed(metadata.availabilityRequirements, sourceCharacter, conversation.gameData)) continue;
      try {
        const context = { gameData: conversation.gameData, sourceCharacter };
        const checkResult = await loaded.definition.check(context);
        if (!checkResult?.canExecute) continue;
        const targetIds = metadata.targetPolicy === "none" ? [] : (checkResult.validTargetCharacterIds || [])
          .map(Number)
          .filter((id) => participantIds.has(id) && targetAllowed(metadata.targetPolicy, sourceCharacter.id, id))
          .sort((left, right) => left - right);
        const requiresTarget = metadata.targetPolicy !== "none";
        if (requiresTarget && targetIds.length === 0) continue;
        const args = resolveArguments(loaded.definition, context, language, resolveI18nString);
        const rawDescription = typeof loaded.definition.description === "function" ? loaded.definition.description(context) : loaded.definition.description;
        entries.push(Object.freeze({
          actionId: loaded.id,
          sourceCharacterId: sourceCharacter.id,
          shortDescription: metadata.selectorContract.shortDescription,
          sourceRole: metadata.selectorContract.sourceRole,
          targetRole: metadata.selectorContract.targetRole,
          targetPolicy: metadata.targetPolicy,
          validTargetCharacterIds: Object.freeze(targetIds),
          requiresTarget,
          arguments: Object.freeze(args),
          description: localize(rawDescription, language, resolveI18nString),
          metadata
        }));
      } catch (error) {
        registry.registerValidation?.(loaded.id, { valid: false, message: `check() threw: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
  }
  entries.sort((left, right) => left.actionId.localeCompare(right.actionId) || Number(left.sourceCharacterId) - Number(right.sourceCharacterId));
  return Object.freeze({ version: CATALOG_VERSION, state, entries: Object.freeze(entries) });
}

function findEntry(catalog, actionId, sourceCharacterId) {
  return catalog.entries.find((entry) => entry.actionId === actionId && Number(entry.sourceCharacterId) === Number(sourceCharacterId)) || null;
}

function serialize(catalog) {
  return JSON.stringify(catalog.entries.map((entry) => ({
    actionId: entry.actionId,
    sourceCharacterId: entry.sourceCharacterId,
    validTargetCharacterIds: entry.validTargetCharacterIds,
    arguments: entry.arguments.map((arg) => ({
      name: arg.name,
      type: arg.type,
      required: arg.required === true,
      min: arg.min,
      max: arg.max,
      step: arg.step,
      options: arg.options
    }))
  })));
}

module.exports = { isParticipantOverrideArgument, build, findEntry, serialize, sourceAllowed };
