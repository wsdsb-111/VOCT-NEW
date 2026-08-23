"use strict";

const vm = require("vm");

const BLOCKED_GLOBALS = Object.freeze({
  require: undefined,
  process: undefined,
  global: undefined,
  globalThis: undefined,
  eval: undefined,
  Function: undefined,
  Buffer: undefined,
  module: undefined,
  exports: undefined,
  __dirname: undefined,
  __filename: undefined
});

function createSandbox(additions = {}) {
  return {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Date,
    Math,
    JSON,
    RegExp,
    Error,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float32Array,
    Float64Array,
    ...BLOCKED_GLOBALS,
    ...additions
  };
}

function createContext(sandbox) {
  return vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false }
  });
}

function runScript(code, { filename, sandbox, timeout = 1000 } = {}) {
  const context = createContext(sandbox || createSandbox());
  const script = new vm.Script(code, { filename });
  return script.runInContext(context, {
    displayErrors: true,
    breakOnSigint: true,
    timeout
  });
}

module.exports = {
  BLOCKED_GLOBALS,
  createSandbox,
  createContext,
  runScript
};
