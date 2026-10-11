"use strict";

const indexes = new WeakMap();

function add(map, runtimeId, definitionId) {
  const key = String(runtimeId || "");
  const value = String(definitionId || "");
  if (!key || !value) return;
  const values = map.get(key) || [];
  if (!values.includes(value)) values.push(value);
  map.set(key, values);
}

function getRuntimeDefinitionIndex(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return { forwardByDefinition: new Map(), reverseByRuntime: new Map(), definitionsByRuntime: new Map() };
  if (indexes.has(snapshot)) return indexes.get(snapshot);
  const forwardByDefinition = new Map();
  const reverseByRuntime = new Map();
  const definitionsByRuntime = new Map();
  for (const [definitionId, runtimeId] of Object.entries(snapshot.definitionToRuntime || {})) {
    forwardByDefinition.set(String(definitionId), String(runtimeId));
    add(definitionsByRuntime, runtimeId, definitionId);
  }
  for (const [runtimeId, definitionIds] of Object.entries(snapshot.runtimeToDefinitions || {})) for (const definitionId of Array.isArray(definitionIds) ? definitionIds : []) {
    add(reverseByRuntime, runtimeId, definitionId);
    add(definitionsByRuntime, runtimeId, definitionId);
  }
  const index = { forwardByDefinition, reverseByRuntime, definitionsByRuntime };
  indexes.set(snapshot, index);
  return index;
}

function runtimeDefinitionIds(snapshot, runtimeId) {
  return getRuntimeDefinitionIndex(snapshot).definitionsByRuntime.get(String(runtimeId)) || [];
}

module.exports = { getRuntimeDefinitionIndex, runtimeDefinitionIds };
