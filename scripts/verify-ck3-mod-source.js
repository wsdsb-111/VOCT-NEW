'use strict';

const {
  EXPECTED_UPSTREAM_REVISION,
  MOD_UPSTREAM_VERSION,
  SourceError,
  assertDescriptorVersion,
  compareTrees,
  parseOptions,
  readInputsManifest,
  safeInputPath,
  verifyModTree
} = require('./audit-v96-source/source-utils');

try {
  const options = parseOptions(process.argv.slice(2));
  const modDir = safeInputPath(options['--mod-dir'], 'ck3-mod');
  const manifest = readInputsManifest();
  const source = verifyModTree(modDir, manifest);
  const result = {
    status: 'PASS',
    manifest: 'build/ck3-mod-inputs.json',
    fileCount: source.fileCount,
    totalBytes: source.totalBytes,
    sourceRevision: source.sourceRevision,
    modPayloadTreeSha256: source.modPayloadTreeSha256,
    artifactSha256: source.artifactSha256,
    artifactHashScope: source.artifactHashScope
  };
  if (options['--upstream-dir']) {
    const upstreamDir = safeInputPath(options['--upstream-dir']);
    assertDescriptorVersion(upstreamDir, MOD_UPSTREAM_VERSION);
    result.upstreamRevision = EXPECTED_UPSTREAM_REVISION;
    result.upstreamComparison = compareTrees(modDir, upstreamDir);
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch (error) {
  const message = error instanceof SourceError ? error.message : 'Unable to verify the Mod source tree.';
  process.stderr.write('CK3 Mod source verification failed: ' + message + '\n');
  process.exitCode = 1;
}
