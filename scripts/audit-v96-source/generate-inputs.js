'use strict';

const fs = require('node:fs');
const {
  EXPECTED_FILE_COUNT,
  INPUTS_PATH,
  SourceError,
  calculateInputManifest,
  safeInputPath,
  verifyFrozenDeclarations
} = require('./source-utils');

function parseOptions(argv) {
  let modDir;
  let write = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--write') {
      if (write) throw new SourceError('Duplicate option: --write.');
      write = true;
      continue;
    }
    if (argument === '--mod-dir') {
      if (modDir !== undefined || !argv[index + 1] || argv[index + 1].startsWith('--')) {
        throw new SourceError('Provide one value after --mod-dir.');
      }
      modDir = argv[++index];
      continue;
    }
    throw new SourceError('Unknown option: ' + argument);
  }
  return { modDir, write };
}

try {
  const options = parseOptions(process.argv.slice(2));
  const modDir = safeInputPath(options.modDir, 'ck3-mod');
  const manifest = calculateInputManifest(modDir);
  if (manifest.fileCount !== EXPECTED_FILE_COUNT) {
    throw new SourceError('The reviewed Mod input set must contain exactly 97 files.');
  }
  verifyFrozenDeclarations(modDir);
  const serialized = JSON.stringify(manifest, null, 2) + '\n';
  if (options.write) {
    fs.writeFileSync(INPUTS_PATH, serialized, { encoding: 'utf8' });
  }
  process.stdout.write(JSON.stringify({
    status: options.write ? 'WRITTEN' : 'PREVIEW',
    manifest: 'build/ck3-mod-inputs.json',
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes,
    sourceRevision: manifest.sourceRevision,
    modPayloadTreeSha256: manifest.modPayloadTreeSha256,
    artifactSha256: manifest.artifactSha256,
    artifactHashScope: manifest.artifactHashScope
  }) + '\n');
} catch (error) {
  const message = error instanceof SourceError ? error.message : 'Unable to generate the Mod input manifest (' + (error.code || error.name || 'unknown error') + ').';
  process.stderr.write('V9.6 Mod input generation failed: ' + message + '\n');
  process.exitCode = 1;
}
