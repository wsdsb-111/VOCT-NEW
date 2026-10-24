'use strict';

const path = require('node:path');
const {
  EXPECTED_UPSTREAM_REVISION,
  MAINTAINED_MOD_BASE,
  MOD_UPSTREAM_VERSION,
  REPOSITORY_ROOT,
  SourceError,
  assertDescriptorVersion,
  calculateInputManifest,
  compareTrees,
  getFileRows,
  parseOptions,
  readInputsManifest,
  safeInputPath,
  verifyModTree
} = require('./source-utils');

try {
  const options = parseOptions(process.argv.slice(2));
  const modDir = safeInputPath(options['--mod-dir'], 'ck3-mod');
  const repositoryModDir = path.join(REPOSITORY_ROOT, 'ck3-mod');
  assertDescriptorVersion(modDir, MAINTAINED_MOD_BASE);
  const snapshot = calculateInputManifest(modDir);
  const repository = verifyModTree(repositoryModDir, readInputsManifest());
  const result = {
    schema: 'votc-v96-source-audit/v1',
    toolVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    upstreamRevision: options['--upstream-dir'] ? EXPECTED_UPSTREAM_REVISION : null,
    machineSnapshot: {
      fileCount: snapshot.fileCount,
      totalBytes: snapshot.totalBytes,
      modPayloadTreeSha256: snapshot.modPayloadTreeSha256
    },
    repositorySource: {
      fileCount: repository.fileCount,
      totalBytes: repository.totalBytes,
      modPayloadTreeSha256: repository.modPayloadTreeSha256
    },
    snapshotToRepository: compareTrees(modDir, repositoryModDir),
    repositoryToUpstream: null
  };
  if (options['--upstream-dir']) {
    const upstreamDir = safeInputPath(options['--upstream-dir']);
    assertDescriptorVersion(upstreamDir, MOD_UPSTREAM_VERSION);
    result.repositoryToUpstream = compareTrees(repositoryModDir, upstreamDir);
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch (error) {
  const message = error instanceof SourceError ? error.message : 'Unable to read one of the supplied source trees.';
  process.stderr.write('V9.6 source audit failed: ' + message + '\n');
  process.exitCode = 1;
}
