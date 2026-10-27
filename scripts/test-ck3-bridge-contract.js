'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseBridgeHello } = require('../src/app/main/bridge/bridge-hello-parser');
const {
  HELLO_LINE,
  REPOSITORY_ROOT,
  verifyFrozenDeclarations
} = require('./audit-v96-source/source-utils');

const contractRoot = path.join(REPOSITORY_ROOT, 'contracts', 'ck3-bridge');
const runtimeManifestPath = path.join(REPOSITORY_ROOT, 'src', 'app', 'main', 'bridge', 'runtime-manifest.json');
const modInputsPath = path.join(REPOSITORY_ROOT, 'build', 'ck3-mod-inputs.json');
const capabilityIds = [
  'character_export',
  'trait_export',
  'native_date',
  'load_session',
  'runfile_consumer',
  'run_ack',
  'action_readback',
  'letter_receipt',
  'official_recollection_export'
];
const featureRequirements = {
  conversation: ['character_export', 'load_session'],
  action: ['runfile_consumer', 'run_ack'],
  letter: ['native_date', 'load_session', 'runfile_consumer', 'run_ack', 'letter_receipt'],
  actionConfirmation: ['action_readback'],
  traits: ['trait_export'],
  officialRecollection: ['official_recollection_export']
};
const fixtureNames = [
  'hello-valid.json',
  'hello-legacy.json',
  'hello-invalid.json',
  'hello-missing-required.json',
  'hello-optional-missing.json',
  'hello-different-base-versions.json',
  'hello-unknown-required.json',
  'hello-unknown-optional.json'
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
}

function evaluate(parsed, runtimeManifest) {
  const protocolRange = runtimeManifest.bridgeProtocol;
  const isCompatible = parsed.schemaVersion === runtimeManifest.schemaVersion &&
    parsed.bridgeProtocol.major === protocolRange.major &&
    parsed.bridgeProtocol.minor >= protocolRange.minMinor && parsed.bridgeProtocol.minor <= protocolRange.maxMinor;
  if (!isCompatible) return { state: 'INCOMPATIBLE', reason: 'UNSUPPORTED_PROTOCOL_OR_SCHEMA' };
  for (const [id, declaration] of Object.entries(parsed.capabilities)) {
    if (!Object.hasOwn(runtimeManifest.capabilities, id) && declaration.required) {
      return { state: 'INCOMPATIBLE', reason: 'UNKNOWN_REQUIRED_CAPABILITY' };
    }
  }

  const features = {};
  for (const [feature, contract] of Object.entries(runtimeManifest.features)) {
    const missing = contract.required.filter(id => {
      const range = runtimeManifest.capabilities[id];
      const revision = parsed.capabilities[id]?.revision;
      return !Number.isInteger(revision) || revision < range.minRevision || revision > range.maxRevision;
    });
    const coreMissing = missing.some(id => id === 'character_export' || id === 'load_session');
    features[feature] = {
      allowed: missing.length === 0,
      reasonCode: missing.length === 0 ? 'FEATURE_CAPABILITIES_SUPPORTED' : coreMissing ? 'REQUIRED_CAPABILITY_MISSING' : 'OPTIONAL_CAPABILITY_MISSING',
      missing
    };
  }
  const missingCore = ['character_export', 'load_session'].some(id => {
    const range = runtimeManifest.capabilities[id];
    const revision = parsed.capabilities[id]?.revision;
    return !Number.isInteger(revision) || revision < range.minRevision || revision > range.maxRevision;
  });
  if (missingCore) return { state: 'INCOMPATIBLE', reason: 'REQUIRED_CAPABILITY_MISSING', features };
  if (Object.values(features).some(feature => !feature.allowed)) {
    return { state: 'DEGRADED', reason: 'OPTIONAL_CAPABILITY_MISSING', features };
  }
  return { state: 'SUPPORTED', features };
}

const manifestSchema = readJson(path.join(contractRoot, 'manifest.schema.json'));
const protocolSchema = readJson(path.join(contractRoot, 'protocol.schema.json'));
const matrix = readJson(path.join(contractRoot, 'compatibility-matrix.json'));
const runtimeManifest = readJson(runtimeManifestPath);
const modInputs = readJson(modInputsPath);
const dispositions = readJson(path.join(REPOSITORY_ROOT, 'scripts', 'audit-v96-source', 'source-dispositions.json'));
assert.equal(manifestSchema.$schema, 'https://json-schema.org/draft/2020-12/schema');
assert.equal(manifestSchema.properties.fileCount.const, 97);
assert(manifestSchema.required.includes('gameCompatibility'));
assert.equal(manifestSchema.properties.gameCompatibility.properties.target.const, 'CK3 1.20.*');
assert.deepEqual(manifestSchema.properties.gameCompatibility.properties.verifiedVersions.const, []);
assert.equal(protocolSchema.$schema, 'https://json-schema.org/draft/2020-12/schema');
assert.deepEqual(protocolSchema.required, [
  'schemaVersion',
  'bridgeProtocol',
  'modBaseVersion',
  'upstreamBaseVersion',
  'voctBridgeRevision',
  'loadEpoch',
  'capabilities'
]);
assert.equal(runtimeManifest.schemaVersion, 1);
assert.equal(runtimeManifest.runtimeVersion, require('../src/app/package.json').version);
assert.deepEqual(runtimeManifest.bridgeProtocol, { major: 1, minMinor: 0, maxMinor: 0 });
assert.deepEqual(Object.keys(runtimeManifest.capabilities).sort(), [...capabilityIds].sort());
for (const value of Object.values(runtimeManifest.capabilities)) assert.deepEqual(value, { minRevision: 1, maxRevision: 1 });
assert.deepEqual(Object.fromEntries(Object.entries(runtimeManifest.features).map(([key, value]) => [key, value.required])), featureRequirements);
assert.equal(runtimeManifest.mod.upstreamBaseVersion, '2.0.4');
assert.equal(runtimeManifest.mod.maintainedModBase, '2.0.5');
assert.equal(matrix.evidenceBoundary.includes('do not establish CK3 engine emission'), true);
assert.deepEqual(matrix.wireContract.segments, ['schema', 'protocol', 'mod', 'upstream', 'revision', 'load', 'caps']);
assert.equal(matrix.wireContract.currentLine, HELLO_LINE.slice('debug_log = "'.length, -1));
assert.equal(matrix.wireContract.currentCapabilitiesUseRequiredMarker, false);
assert.equal(modInputs.schema, 'votc-ck3-mod-inputs/v1');
assert.equal(modInputs.source.upstreamBaseVersion, '2.0.4');
assert.equal(modInputs.source.maintainedModBase, '2.0.5');
assert.deepEqual(modInputs.gameCompatibility, { target: 'CK3 1.20.*', verifiedVersions: [] });
assert.equal(modInputs.files.length, 97);
assert.equal(modInputs.fileCount, 97);
assert.equal(modInputs.totalBytes, modInputs.files.reduce((sum, file) => sum + file.size, 0));
assert.equal(modInputs.files.some(file => file.relativePath.includes('\\') || path.isAbsolute(file.relativePath) || /\.exe$/iu.test(file.relativePath)), false);
assert(modInputs.files.some(file => file.relativePath === 'LICENSE.MD'));
const canonicalFileList = [...modInputs.files]
  .sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'en'))
  .map(file => `${file.relativePath}\0${file.size}\0${file.sha256}\n`)
  .join('');
const payloadFingerprint = crypto.createHash('sha256').update(canonicalFileList, 'utf8').digest('hex');
assert.equal(payloadFingerprint, '866f32ba82bb6d9c7d0dec4aee8568450efbfe60e7f4e151c1c13d7c0c4db8eb');
assert.equal(modInputs.sourceRevision, payloadFingerprint);
assert.equal(modInputs.modPayloadTreeSha256, payloadFingerprint);
assert.equal(modInputs.artifactSha256, payloadFingerprint);
assert.equal(dispositions.normalizedTextDifferences.length, 19);
assert.equal(dispositions.localOnlyFiles.length, 5);
assert.equal(dispositions.upstreamOnlyFiles.length, 3);
assert.equal(dispositions.source.licensePreservation.relativePath, 'LICENSE.MD');
assert(dispositions.normalizedTextDifferences.every(item => item.disposition === 'retain_user_authorized_maintained_2.0.5_snapshot' && item.observedDiff));
verifyFrozenDeclarations(path.join(REPOSITORY_ROOT, 'ck3-mod'));

for (const name of fixtureNames) {
  const fixture = readJson(path.join(contractRoot, 'fixtures', name));
  assert.equal(fixture.provenance, 'synthetic_static_contract', name);
  let actual;
  if (fixture.input.kind === 'load-session-without-bridge-hello') {
    actual = {
      state: matrix.legacyWithoutHello.state,
      reason: matrix.legacyWithoutHello.reason,
      inheritPreviousSession: matrix.legacyWithoutHello.inheritPreviousSession
    };
  } else {
    const parsed = parseBridgeHello(fixture.input.line);
    if (!parsed || parsed.ok !== true) {
      assert.equal(fixture.fixtureId, 'hello-unknown-required-capability', name);
      actual = { state: matrix.unknownRequiredCapability.state, reason: matrix.unknownRequiredCapability.reason };
    } else {
      actual = evaluate(parsed.hello, runtimeManifest);
    }
  }
  assert.deepEqual(actual, fixture.expected, name);
}

const validFixture = readJson(path.join(contractRoot, 'fixtures', 'hello-valid.json'));
const parsedValid = parseBridgeHello(validFixture.input.line).hello;
assert.deepEqual(Object.keys(parsedValid.capabilities).sort(), [...capabilityIds].sort());
for (const capability of Object.values(parsedValid.capabilities)) assert.deepEqual(capability, { revision: 1, required: false });
assert(HELLO_LINE.includes('/;/caps=character_export:1,trait_export:1,native_date:1,load_session:1,runfile_consumer:1,run_ack:1,action_readback:1,letter_receipt:1,official_recollection_export:1'));
process.stdout.write(JSON.stringify({
  status: 'PASS',
  fixtures: fixtureNames.length,
  capabilities: capabilityIds.length,
  features: Object.keys(featureRequirements).length,
  provenance: 'synthetic_static_contract_only',
  ck3EngineVerified: false
}) + '\n');
