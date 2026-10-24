'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REPOSITORY_ROOT = path.resolve(__dirname, '../..');
const INPUTS_PATH = path.join(REPOSITORY_ROOT, 'build', 'ck3-mod-inputs.json');
const EXPECTED_UPSTREAM_REVISION = '0cf4845a69f9e8633333ca04e558afe8216490f2';
const MOD_UPSTREAM_VERSION = '2.0.4';
const MAINTAINED_MOD_BASE = '2.0.5';
const BRIDGE_REVISION = 1;
const EXPECTED_FILE_COUNT = 97;
const TREE_HASH_RULE = 'SHA-256 of UTF-8 relativePath + NUL + decimal size + NUL + lowercase file SHA-256 + LF, sorted by relativePath.localeCompare(en).';
const HELLO_LINE = "debug_log = \"VOTC:BRIDGE_HELLO/;/schema=1/;/protocol=1.0/;/mod=2.0.5/;/upstream=2.0.4/;/revision=1/;/load=votc-load-[GetGlobalVariable('votc_load_epoch').GetValue]/;/caps=character_export:1,trait_export:1,native_date:1,load_session:1,runfile_consumer:1,run_ack:1,action_readback:1,letter_receipt:1,official_recollection_export:1\"";

class SourceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SourceError';
  }
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function normalizeRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\\') || relativePath.includes(':') || relativePath.startsWith('/') || /^[A-Za-z]:/.test(relativePath)) {
    throw new SourceError('Manifest path is not a normalized relative path.');
  }
  const parts = relativePath.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[\u0000-\u001f]/u.test(part))) {
    throw new SourceError('Manifest path contains an invalid segment: ' + relativePath);
  }
  if (path.posix.normalize(relativePath) !== relativePath) {
    throw new SourceError('Manifest path is not canonical: ' + relativePath);
  }
  return relativePath;
}

function resolveWithinRoot(root, relativePath) {
  const canonical = normalizeRelativePath(relativePath);
  const rootPath = path.resolve(root);
  const resolved = path.resolve(rootPath, ...canonical.split('/'));
  const relative = path.relative(rootPath, resolved);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new SourceError('Path escapes or aliases the tree root: ' + canonical);
  }
  return resolved;
}

function assertCaseUnique(paths) {
  const byFoldedPath = new Map();
  for (const relativePath of paths) {
    normalizeRelativePath(relativePath);
    const folded = relativePath.toLowerCase();
    const previous = byFoldedPath.get(folded);
    if (previous && previous !== relativePath) {
      throw new SourceError('Case-colliding paths: ' + previous + ' and ' + relativePath);
    }
    byFoldedPath.set(folded, relativePath);
  }
}

function assertNoReparsePoint(root) {
  let stat;
  try {
    stat = fs.lstatSync(root);
  } catch {
    throw new SourceError('Tree root is missing or unreadable.');
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new SourceError('Tree root must be a real directory, not a link.');
  }
}

function walkTree(root, { ignoreRootGit = false } = {}) {
  const rootPath = path.resolve(root);
  assertNoReparsePoint(rootPath);
  const files = [];
  const nodes = [];

  function walk(folder, prefix = '', atRoot = false) {
    let entries;
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'));
    } catch {
      throw new SourceError('A Mod source directory cannot be read.');
    }
    for (const entry of entries) {
      if (atRoot && ignoreRootGit && entry.name === '.git') continue;
      const relativePath = prefix ? prefix + '/' + entry.name : entry.name;
      normalizeRelativePath(relativePath);
      nodes.push(relativePath);
      const fullPath = path.join(folder, entry.name);
      let stat;
      try {
        stat = fs.lstatSync(fullPath);
      } catch {
        throw new SourceError('A Mod source entry cannot be inspected: ' + relativePath);
      }
      if (stat.isSymbolicLink()) {
        throw new SourceError('Symbolic links are not allowed: ' + relativePath);
      }
      if (stat.isDirectory()) {
        walk(fullPath, relativePath);
      } else if (stat.isFile()) {
        if (/\.exe$/iu.test(relativePath)) {
          throw new SourceError('Executable files are not allowed in a Mod payload: ' + relativePath);
        }
        files.push({ relativePath, fullPath, size: stat.size });
      } else {
        throw new SourceError('Non-regular files are not allowed: ' + relativePath);
      }
    }
  }

  walk(rootPath, '', true);
  assertCaseUnique(nodes);
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'en'));
}

function getFileRows(root, options) {
  return walkTree(root, options).map(file => {
    let bytes;
    try {
      bytes = fs.readFileSync(file.fullPath);
    } catch {
      throw new SourceError('A Mod source file cannot be read: ' + file.relativePath);
    }
    return { relativePath: file.relativePath, size: bytes.length, sha256: sha256(bytes) };
  });
}

function canonicalFileListBytes(files) {
  assertCaseUnique(files.map(file => file.relativePath));
  const ordered = [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'en'));
  return Buffer.from(ordered.map(file => `${file.relativePath}\0${file.size}\0${file.sha256}\n`).join(''), 'utf8');
}

function calculateInputManifest(root) {
  const files = getFileRows(root);
  const canonical = canonicalFileListBytes(files);
  const fingerprint = sha256(canonical);
  return {
    schema: 'votc-ck3-mod-inputs/v1',
    source: {
      upstreamRepository: 'Voices-of-the-Court/votc_mod',
      upstreamRevision: EXPECTED_UPSTREAM_REVISION,
      upstreamBaseVersion: MOD_UPSTREAM_VERSION,
      maintainedModBase: MAINTAINED_MOD_BASE,
      bridgeRevision: BRIDGE_REVISION
    },
    gameCompatibility: {
      target: 'CK3 1.20.*',
      verifiedVersions: []
    },
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.size, 0),
    treeHashRule: TREE_HASH_RULE,
    sourceRevision: fingerprint,
    modPayloadTreeSha256: fingerprint,
    artifactSha256: fingerprint,
    artifactHashScope: 'mod-payload-tree; no archive or ZIP is implied',
    files
  };
}

function readInputsManifest() {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(INPUTS_PATH, 'utf8').replace(/^\uFEFF/u, ''));
  } catch {
    throw new SourceError('build/ck3-mod-inputs.json is missing or invalid JSON.');
  }
  validateInputsManifestShape(manifest);
  return manifest;
}

function validateInputsManifestShape(manifest) {
  if (!manifest || manifest.schema !== 'votc-ck3-mod-inputs/v1') {
    throw new SourceError('Unsupported Mod inputs manifest schema.');
  }
  if (!manifest.source || manifest.source.upstreamRevision !== EXPECTED_UPSTREAM_REVISION ||
      manifest.source.upstreamRepository !== 'Voices-of-the-Court/votc_mod' ||
      manifest.source.upstreamBaseVersion !== MOD_UPSTREAM_VERSION || manifest.source.maintainedModBase !== MAINTAINED_MOD_BASE ||
      manifest.source.bridgeRevision !== BRIDGE_REVISION) {
    throw new SourceError('Mod provenance does not match the fixed upstream and maintained base.');
  }
  if (!manifest.gameCompatibility || Object.keys(manifest.gameCompatibility).sort().join(',') !== 'target,verifiedVersions' ||
      manifest.gameCompatibility.target !== 'CK3 1.20.*' ||
      !Array.isArray(manifest.gameCompatibility.verifiedVersions) || manifest.gameCompatibility.verifiedVersions.length !== 0) {
    throw new SourceError('Game compatibility is a descriptor target only; no CK3 versions are verified.');
  }
  if (!Array.isArray(manifest.files) || manifest.files.length !== EXPECTED_FILE_COUNT || manifest.fileCount !== EXPECTED_FILE_COUNT) {
    throw new SourceError('Mod input manifest must contain the reviewed 97-file payload.');
  }
  const paths = [];
  for (const file of manifest.files) {
    if (!file || !Number.isSafeInteger(file.size) || file.size < 0 || !/^[0-9a-f]{64}$/u.test(file.sha256)) {
      throw new SourceError('Mod input file metadata is invalid.');
    }
    paths.push(normalizeRelativePath(file.relativePath));
  }
  assertCaseUnique(paths);
  if (manifest.files.some(file => /\.exe$/iu.test(file.relativePath))) {
    throw new SourceError('Executable files are not allowed in the Mod payload.');
  }
  if (!/^[0-9a-f]{64}$/u.test(manifest.sourceRevision) || !/^[0-9a-f]{64}$/u.test(manifest.modPayloadTreeSha256) ||
      !/^[0-9a-f]{64}$/u.test(manifest.artifactSha256) || manifest.artifactHashScope !== 'mod-payload-tree; no archive or ZIP is implied') {
    throw new SourceError('Mod payload fingerprints are missing or have an unsupported scope.');
  }
}

function normalizeText(bytes) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  return text.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
}

function compareTrees(modDir, upstreamDir) {
  const localRows = getFileRows(modDir);
  const upstreamRows = getFileRows(upstreamDir, { ignoreRootGit: true });
  const local = new Map(localRows.map(row => [row.relativePath, row]));
  const upstream = new Map(upstreamRows.map(row => [row.relativePath, row]));
  const allPaths = [...new Set([...local.keys(), ...upstream.keys()])].sort((a, b) => a.localeCompare(b, 'en'));
  const comparisons = allPaths.map(relativePath => {
    const localRow = local.get(relativePath);
    const upstreamRow = upstream.get(relativePath);
    if (!localRow) return { relativePath, status: 'UPSTREAM_ONLY' };
    if (!upstreamRow) return { relativePath, status: 'LOCAL_ONLY', localSha256: localRow.sha256, localSize: localRow.size };
    const localBytes = fs.readFileSync(resolveWithinRoot(modDir, relativePath));
    const upstreamBytes = fs.readFileSync(resolveWithinRoot(upstreamDir, relativePath));
    if (localBytes.equals(upstreamBytes)) return { relativePath, status: 'BYTE_IDENTICAL' };
    const textLike = /\.(?:txt|gui|yml|md|mod)$/iu.test(relativePath);
    const normalizedLocal = textLike ? normalizeText(localBytes) : null;
    const normalizedUpstream = textLike ? normalizeText(upstreamBytes) : null;
    const textEqualIgnoringBomAndEol = textLike && normalizedLocal !== null && normalizedUpstream !== null && normalizedLocal === normalizedUpstream;
    return {
      relativePath,
      status: textEqualIgnoringBomAndEol ? 'BOM_EOL_ONLY' : textLike ? 'TEXT_CONTENT_DIFFER' : 'BINARY_DIFFER',
      localSha256: localRow.sha256,
      upstreamSha256: upstreamRow.sha256,
      textEqualIgnoringBomAndEol: textLike ? textEqualIgnoringBomAndEol : undefined
    };
  });
  const counts = comparisons.reduce((result, item) => {
    result[item.status] = (result[item.status] || 0) + 1;
    return result;
  }, {});
  return { fileCount: comparisons.length, counts, comparisons };
}

function assertDescriptorVersion(root, expectedVersion) {
  let descriptor;
  try {
    descriptor = fs.readFileSync(resolveWithinRoot(root, 'descriptor.mod'), 'utf8').replace(/^\uFEFF/u, '');
  } catch {
    throw new SourceError('A Mod tree is missing descriptor.mod.');
  }
  const escapedVersion = expectedVersion.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const versionExpression = new RegExp('^version\\s*=\\s*"' + escapedVersion + '"\\s*$', 'mu');
  if (!versionExpression.test(descriptor)) {
    throw new SourceError('Mod descriptor version does not match the expected ' + expectedVersion + '.');
  }
  return descriptor;
}

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (!argument.startsWith('--')) throw new SourceError('Unexpected positional argument.');
    const separator = argument.indexOf('=');
    const name = separator >= 0 ? argument.slice(0, separator) : argument;
    const value = separator >= 0 ? argument.slice(separator + 1) : argv[++index];
    if (!value || value.startsWith('--')) throw new SourceError('Missing value for ' + name + '.');
    if (!['--mod-dir', '--upstream-dir', '--upstream-revision'].includes(name)) {
      throw new SourceError('Unknown option: ' + name);
    }
    if (Object.hasOwn(options, name)) throw new SourceError('Duplicate option: ' + name);
    options[name] = value;
  }
  if (options['--upstream-dir'] && options['--upstream-revision'] !== EXPECTED_UPSTREAM_REVISION) {
    throw new SourceError('--upstream-dir requires the exact fixed --upstream-revision ' + EXPECTED_UPSTREAM_REVISION + '.');
  }
  if (options['--upstream-revision'] && options['--upstream-revision'] !== EXPECTED_UPSTREAM_REVISION) {
    throw new SourceError('Only the fixed upstream revision is allowed: ' + EXPECTED_UPSTREAM_REVISION + '.');
  }
  return options;
}

function safeInputPath(value, fallback) {
  return path.resolve(REPOSITORY_ROOT, value || fallback);
}

function verifyModTree(modDir, manifest = readInputsManifest()) {
  const expectedRows = manifest.files;
  const actualRows = getFileRows(modDir);
  const expectedPaths = expectedRows.map(row => row.relativePath);
  const actualPaths = actualRows.map(row => row.relativePath);
  assertCaseUnique(expectedPaths);
  assertCaseUnique(actualPaths);
  if (expectedPaths.length !== actualPaths.length || expectedPaths.some((item, index) => item !== actualPaths[index])) {
    throw new SourceError('Mod tree paths do not exactly match build/ck3-mod-inputs.json.');
  }
  for (let index = 0; index < expectedRows.length; index++) {
    const expected = expectedRows[index];
    const actual = actualRows[index];
    if (expected.size !== actual.size || expected.sha256 !== actual.sha256) {
      throw new SourceError('Mod payload hash mismatch: ' + expected.relativePath);
    }
  }
  const calculated = calculateInputManifest(modDir);
  if (manifest.totalBytes !== calculated.totalBytes || manifest.sourceRevision !== calculated.sourceRevision ||
      manifest.modPayloadTreeSha256 !== calculated.modPayloadTreeSha256 || manifest.artifactSha256 !== calculated.artifactSha256) {
    throw new SourceError('Mod payload aggregate fingerprint does not match the file list.');
  }
  if (manifest.treeHashRule !== TREE_HASH_RULE) {
    throw new SourceError('Mod payload tree hash rule does not match the documented canonicalization.');
  }
  verifyFrozenDeclarations(modDir);
  return calculated;
}

function verifyFrozenDeclarations(modDir) {
  const descriptorPath = resolveWithinRoot(modDir, 'descriptor.mod');
  const boundaryPath = resolveWithinRoot(modDir, 'common/on_action/votc_load_boundary.txt');
  let descriptor;
  let boundary;
  try {
    descriptor = fs.readFileSync(descriptorPath, 'utf8').replace(/^\uFEFF/u, '');
    boundary = fs.readFileSync(boundaryPath, 'utf8').replace(/^\uFEFF/u, '');
  } catch {
    throw new SourceError('Mod is missing descriptor.mod or the load-boundary source.');
  }
  if (!/^version\s*=\s*"2\.0\.5"\s*$/mu.test(descriptor)) {
    throw new SourceError('descriptor.mod must remain at maintained Workshop version 2.0.5.');
  }
  const lines = boundary.split(/\r?\n/u);
  const loadIndices = lines.map((line, index) => line.trim() === "debug_log = \"VOTC:LOAD_SESSION/;/votc-load-[GetGlobalVariable('votc_load_epoch').GetValue]\"" ? index : -1).filter(index => index >= 0);
  const helloIndices = lines.map((line, index) => line.trim() === HELLO_LINE ? index : -1).filter(index => index >= 0);
  if (loadIndices.length !== 1 || helloIndices.length !== 1 || helloIndices[0] !== loadIndices[0] + 1) {
    throw new SourceError('Exactly one frozen BRIDGE_HELLO declaration must immediately follow LOAD_SESSION.');
  }
  const loadIndex = loadIndices[0];
  const effectStart = lines.slice(0, loadIndex).lastIndexOf('\teffect = {');
  const effectEnd = lines.findIndex((line, index) => index > loadIndex && line === '\t}');
  if (effectStart < 0 || effectEnd < helloIndices[0]) {
    throw new SourceError('LOAD_SESSION and BRIDGE_HELLO must remain inside the same effect.');
  }
}

function makeOutputPath(value, fallback) {
  const output = safeInputPath(value, fallback);
  const relative = path.relative(REPOSITORY_ROOT, output);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new SourceError('Output directory must stay inside the repository or its .build folder.');
  }
  return output;
}

module.exports = {
  BRIDGE_REVISION,
  EXPECTED_FILE_COUNT,
  EXPECTED_UPSTREAM_REVISION,
  HELLO_LINE,
  INPUTS_PATH,
  MAINTAINED_MOD_BASE,
  MOD_UPSTREAM_VERSION,
  REPOSITORY_ROOT,
  SourceError,
  assertDescriptorVersion,
  TREE_HASH_RULE,
  calculateInputManifest,
  compareTrees,
  getFileRows,
  makeOutputPath,
  parseOptions,
  readInputsManifest,
  resolveWithinRoot,
  safeInputPath,
  sha256,
  validateInputsManifestShape,
  verifyFrozenDeclarations,
  verifyModTree,
  walkTree
};
