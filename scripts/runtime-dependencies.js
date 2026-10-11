'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual, TextDecoder } = require('node:util');

const NODE_MODULES_RELATIVE = 'resources/app/node_modules';
const APP_PACKAGE_RELATIVE = 'resources/app/package.json';
const SOURCE_APP_PACKAGE_RELATIVE = 'src/app/package.json';
const LOCK_RELATIVE = 'build/runtime-dependencies.lock.json';
const LOCK_KIND = 'votc-vendored-runtime-dependencies';

function isSafeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')) return false;
  if (value.startsWith('/') || value.includes(':')) return false;
  const segments = value.split('/');
  return segments.every(segment => segment && segment !== '.' && segment !== '..')
    && path.posix.normalize(value) === value;
}

function isExactVersion(value) {
  return typeof value === 'string'
    && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}

function hashFile(bytes) {
  let content = bytes;
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const roundTrip = Buffer.from(decoded, 'utf8');
    if (roundTrip.equals(bytes)) content = Buffer.from(decoded.replace(/\r\n/g, '\n'), 'utf8');
  } catch {}
  return crypto.createHash('sha256').update(content).digest('hex');
}

function readJson(filePath, description, errors) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    errors.push(`${description} is unreadable or invalid JSON: ${error.message}`);
    return null;
  }
}

function listRuntimeFiles(root, errors) {
  const nodeModulesRoot = path.join(root, ...NODE_MODULES_RELATIVE.split('/'));
  const files = [];
  let rootStats;
  try {
    rootStats = fs.lstatSync(nodeModulesRoot);
  } catch (error) {
    errors.push(`${NODE_MODULES_RELATIVE} is unavailable: ${error.message}`);
    return files;
  }
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    errors.push(`${NODE_MODULES_RELATIVE} must be a real directory`);
    return files;
  }

  function walk(directory, relativeDirectory) {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      errors.push(`Cannot read ${relativeDirectory || NODE_MODULES_RELATIVE}: ${error.message}`);
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        errors.push(`Unexpected symbolic link in runtime dependencies: ${relativePath}`);
      } else if (entry.isDirectory()) {
        // Directories without files are intentionally outside the vendored file inventory.
        walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        if (!isSafeRelativePath(relativePath)) errors.push(`Illegal runtime dependency path: ${relativePath}`);
        files.push(relativePath);
      } else {
        errors.push(`Unsupported runtime dependency entry: ${relativePath}`);
      }
    }
  }

  walk(nodeModulesRoot, '');
  return files.sort();
}

function isPackageManifestPath(relativePath) {
  const segments = relativePath.split('/');
  if (segments[segments.length - 1] !== 'package.json') return false;
  const packageJsonIndex = segments.length - 1;
  const nodeModulesIndexes = [-1];
  for (let index = 0; index < packageJsonIndex; index += 1) {
    if (segments[index] === 'node_modules') nodeModulesIndexes.push(index);
  }

  return nodeModulesIndexes.some(index => {
    const firstPackageSegment = index + 1;
    if (firstPackageSegment >= packageJsonIndex) return false;
    if (segments[firstPackageSegment].startsWith('@')) {
      return firstPackageSegment + 2 === packageJsonIndex
        && Boolean(segments[firstPackageSegment + 1]);
    }
    return firstPackageSegment + 1 === packageJsonIndex;
  });
}

function packageNamePath(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.includes('\0')) return null;
  const segments = name.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || segment.includes(':'))) return null;
  if (segments[0].startsWith('@')) return segments.length === 2 ? name : null;
  return segments.length === 1 ? name : null;
}

function makePackageRecords(nodeModulesRoot, files, errors) {
  const manifestPaths = files.filter(isPackageManifestPath).sort();
  const records = [];
  for (const packageJson of manifestPaths) {
    const packageRoot = packageJson.slice(0, -'/package.json'.length);
    const metadata = readJson(path.join(nodeModulesRoot, ...packageJson.split('/')), packageJson, errors);
    if (!metadata || typeof metadata.name !== 'string' || !metadata.name
      || !isExactVersion(metadata.version)) {
      errors.push(`Package metadata must have a name and exact version: ${packageJson}`);
      continue;
    }
    records.push({
      root: packageRoot,
      packageJson,
      name: metadata.name,
      version: metadata.version,
      license: metadata.license === undefined || metadata.license === null || metadata.license === ''
        ? 'UNKNOWN'
        : metadata.license,
      licenseFiles: [],
      nativeFiles: [],
    });
  }

  const rootsLongestFirst = [...records].sort((left, right) => right.root.length - left.root.length);
  for (const relativePath of files) {
    const owner = rootsLongestFirst.find(record => relativePath.startsWith(`${record.root}/`));
    if (!owner) continue;
    const basename = relativePath.slice(relativePath.lastIndexOf('/') + 1);
    if (/^(?:license|licence|copying|notice)(?:[._-].*)?$/i.test(basename)) owner.licenseFiles.push(relativePath);
    if (basename.endsWith('.node')) owner.nativeFiles.push(relativePath);
  }
  records.sort((left, right) => left.root.localeCompare(right.root));
  return records;
}

function verifyRuntimeDependencies(projectRoot = path.resolve(__dirname, '..')) {
  const root = path.resolve(projectRoot);
  const errors = [];
  const lockPath = path.join(root, ...LOCK_RELATIVE.split('/'));
  const lock = readJson(lockPath, LOCK_RELATIVE, errors);
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) {
    return { ok: false, errors, fileCount: 0, packageCount: 0, directVersions: {} };
  }

  if (lock.schemaVersion !== 1 || lock.kind !== LOCK_KIND) errors.push('Unsupported runtime dependency lock schema or kind');
  if (lock.source !== 'git ls-files resources/app/node_modules') errors.push('Runtime dependency lock must record the tracked-file inventory source');
  if (lock.hashPolicy !== 'strict-utf8-roundtrip-crlf-to-lf-otherwise-raw-bytes') errors.push('Runtime dependency lock has an unsupported hash policy');
  if (lock.directoryPolicy !== 'allow-empty-untracked-directories') errors.push('Runtime dependency lock has an unsupported directory policy');

  const lockFiles = Array.isArray(lock.files) ? lock.files : [];
  if (!Array.isArray(lock.files)) errors.push('Runtime dependency lock files must be an array');
  const expectedByPath = new Map();
  for (const entry of lockFiles) {
    if (!entry || typeof entry !== 'object' || !isSafeRelativePath(entry.path)) {
      errors.push(`Illegal runtime dependency lock path: ${entry && entry.path}`);
      continue;
    }
    if (!/^[a-f0-9]{64}$/.test(entry.sha256 || '')) {
      errors.push(`Invalid SHA-256 for runtime dependency file: ${entry.path}`);
      continue;
    }
    if (expectedByPath.has(entry.path)) {
      errors.push(`Duplicate runtime dependency lock path: ${entry.path}`);
      continue;
    }
    expectedByPath.set(entry.path, entry.sha256);
  }
  if (lock.fileCount !== expectedByPath.size) errors.push('Runtime dependency fileCount does not match the lock inventory');

  const nodeModulesRoot = path.join(root, ...NODE_MODULES_RELATIVE.split('/'));
  const actualFiles = listRuntimeFiles(root, errors);
  const actualSet = new Set(actualFiles);
  for (const relativePath of expectedByPath.keys()) {
    if (!actualSet.has(relativePath)) errors.push(`Missing runtime dependency file: ${relativePath}`);
  }
  for (const relativePath of actualFiles) {
    if (!expectedByPath.has(relativePath)) errors.push(`Unexpected runtime dependency file: ${relativePath}`);
  }
  for (const [relativePath, expectedHash] of expectedByPath) {
    if (!actualSet.has(relativePath)) continue;
    try {
      const bytes = fs.readFileSync(path.join(nodeModulesRoot, ...relativePath.split('/')));
      const actualHash = hashFile(bytes);
      if (actualHash !== expectedHash) errors.push(`Runtime dependency content hash mismatch: ${relativePath}`);
    } catch (error) {
      errors.push(`Cannot hash runtime dependency file ${relativePath}: ${error.message}`);
    }
  }

  const packageRecords = makePackageRecords(nodeModulesRoot, actualFiles, errors);
  if (lock.packageCount !== packageRecords.length) errors.push('Runtime dependency packageCount does not match discovered packages');
  if (!Array.isArray(lock.packages)) {
    errors.push('Runtime dependency lock packages must be an array');
  } else if (!isDeepStrictEqual(lock.packages, packageRecords)) {
    errors.push('Runtime dependency package metadata, license inventory, or native file inventory mismatch');
  }

  const manifests = [SOURCE_APP_PACKAGE_RELATIVE, APP_PACKAGE_RELATIVE].map(relativePath => {
    const manifest = readJson(path.join(root, ...relativePath.split('/')), relativePath, errors);
    const dependencies = manifest && manifest.dependencies && typeof manifest.dependencies === 'object'
      && !Array.isArray(manifest.dependencies)
      ? manifest.dependencies
      : {};
    if (!manifest || manifest.dependencies === undefined || typeof manifest.dependencies !== 'object'
      || Array.isArray(manifest.dependencies)) {
      errors.push(`${relativePath} must declare a dependencies object`);
    }
    return { relativePath, dependencies };
  });

  const lockDirectDependencies = lock.directDependencies;
  if (!lockDirectDependencies || typeof lockDirectDependencies !== 'object' || Array.isArray(lockDirectDependencies)) {
    errors.push('Runtime dependency lock directDependencies must be an object');
  }
  const lockedNames = lockDirectDependencies && typeof lockDirectDependencies === 'object'
    && !Array.isArray(lockDirectDependencies)
    ? Object.keys(lockDirectDependencies).sort()
    : [];
  for (const manifest of manifests) {
    const declaredNames = Object.keys(manifest.dependencies).sort();
    if (!isDeepStrictEqual(declaredNames, lockedNames)) {
      errors.push(`Direct dependency inventory does not match ${manifest.relativePath}`);
    }
    for (const name of declaredNames) {
      if (lockDirectDependencies && typeof lockDirectDependencies === 'object'
        && !Array.isArray(lockDirectDependencies)
        && Object.prototype.hasOwnProperty.call(lockDirectDependencies, name)
        && manifest.dependencies[name] !== lockDirectDependencies[name]) {
        errors.push(`Direct dependency declaration version mismatch in ${manifest.relativePath}: ${name} (declared ${manifest.dependencies[name]}, lock ${lockDirectDependencies[name]})`);
      }
    }
  }

  const packageByRoot = new Map(packageRecords.map(record => [record.root, record]));
  const directVersions = {};
  for (const name of lockedNames) {
    const namePath = packageNamePath(name);
    if (!namePath) {
      errors.push(`Illegal direct dependency name: ${name}`);
      continue;
    }
    const manifestRelative = `${namePath}/package.json`;
    const installedMetadata = readJson(path.join(nodeModulesRoot, ...manifestRelative.split('/')), `direct dependency ${name}`, errors);
    if (!installedMetadata) continue;
    if (installedMetadata.name !== name) errors.push(`Direct dependency package name mismatch: ${name}`);
    if (!isExactVersion(installedMetadata.version)) {
      errors.push(`Direct dependency ${name} has no exact installed version`);
      continue;
    }
    directVersions[name] = installedMetadata.version;
    const packageRecord = packageByRoot.get(namePath);
    if (!packageRecord) errors.push(`Missing direct dependency package record: ${name}`);
    else if (packageRecord.name !== name || packageRecord.version !== installedMetadata.version) {
      errors.push(`Direct dependency package metadata mismatch: ${name}`);
    }
    if (lockDirectDependencies && lockDirectDependencies[name] !== installedMetadata.version) {
      errors.push(`Direct dependency version mismatch: ${name} (lock ${lockDirectDependencies[name]}, installed ${installedMetadata.version})`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    fileCount: actualFiles.length,
    packageCount: packageRecords.length,
    directVersions: Object.fromEntries(Object.entries(directVersions).sort(([left], [right]) => left.localeCompare(right))),
  };
}

module.exports = { verifyRuntimeDependencies };

if (require.main === module) {
  const projectRoot = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');
  const result = verifyRuntimeDependencies(projectRoot);
  if (result.ok) {
    console.log(`Runtime dependency verification: PASS (${result.fileCount} files, ${result.packageCount} packages)`);
  } else {
    console.error(`Runtime dependency verification: FAIL (${result.errors.length} issue(s))`);
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
  }
}
