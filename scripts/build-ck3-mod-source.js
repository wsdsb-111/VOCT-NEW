'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  REPOSITORY_ROOT,
  SourceError,
  makeOutputPath,
  readInputsManifest,
  resolveWithinRoot,
  safeInputPath,
  verifyModTree
} = require('./audit-v96-source/source-utils');

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    if (name !== '--mod-dir' && name !== '--output-dir') throw new SourceError('Unknown option: ' + name);
    if (options[name] || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new SourceError('Provide one value after ' + name + '.');
    }
    options[name] = argv[++index];
  }
  return options;
}

function assertNoSymlinkComponents(baseDir, targetPath) {
  const relative = path.relative(baseDir, targetPath);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new SourceError('Candidate output path is outside .build/.');
  }
  let current = baseDir;
  const baseStat = fs.lstatSync(baseDir);
  if (!baseStat.isDirectory() || baseStat.isSymbolicLink()) throw new SourceError('The .build output root must be a real directory.');
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) continue;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new SourceError('Candidate output path crosses a symbolic link.');
    if (current !== targetPath && !stat.isDirectory()) throw new SourceError('Candidate output parent is not a directory.');
  }
}

let candidateDir;
let outputCreated = false;
try {
  const options = parseOptions(process.argv.slice(2));
  const modDir = safeInputPath(options['--mod-dir'], 'ck3-mod');
  const outputDir = makeOutputPath(options['--output-dir'], '.build/ck3-mod-build');
  const buildRoot = path.resolve(REPOSITORY_ROOT, '.build');
  const relativeToBuild = path.relative(buildRoot, outputDir);
  if (!relativeToBuild || relativeToBuild === '..' || relativeToBuild.startsWith('..' + path.sep) || path.isAbsolute(relativeToBuild)) {
    throw new SourceError('Mod candidate output must stay below .build/.');
  }
  assertNoSymlinkComponents(buildRoot, outputDir);
  if (fs.existsSync(outputDir)) throw new SourceError('Candidate output already exists; refusing to overwrite it.');

  const manifest = readInputsManifest();
  const source = verifyModTree(modDir, manifest);
  fs.mkdirSync(path.dirname(outputDir), { recursive: true });
  fs.mkdirSync(outputDir);
  candidateDir = outputDir;
  outputCreated = true;
  for (const file of manifest.files) {
    const sourcePath = resolveWithinRoot(modDir, file.relativePath);
    const outputPath = resolveWithinRoot(outputDir, file.relativePath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.copyFileSync(sourcePath, outputPath);
  }
  const artifact = verifyModTree(outputDir, manifest);
  process.stdout.write(JSON.stringify({
    status: 'BUILT',
    output: path.relative(REPOSITORY_ROOT, outputDir).replaceAll('\\', '/'),
    fileCount: artifact.fileCount,
    totalBytes: artifact.totalBytes,
    sourceRevision: artifact.sourceRevision,
    modPayloadTreeSha256: artifact.modPayloadTreeSha256,
    artifactSha256: artifact.artifactSha256,
    artifactHashScope: artifact.artifactHashScope
  }) + '\n');
} catch (error) {
  if (candidateDir && outputCreated) {
    try {
      const buildRoot = path.resolve(REPOSITORY_ROOT, '.build');
      const relative = path.relative(buildRoot, candidateDir);
      const stat = fs.lstatSync(candidateDir);
      if (relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) && stat.isDirectory() && !stat.isSymbolicLink()) {
        fs.rmSync(candidateDir, { recursive: true, force: true });
      }
    } catch { /* Only the verified new candidate directory is removed. */ }
  }
  const message = error instanceof SourceError ? error.message : 'Unable to build the Mod candidate payload.';
  process.stderr.write('CK3 Mod candidate build failed: ' + message + '\n');
  process.exitCode = 1;
}
