'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { verifyRuntimeDependencies } = require('./runtime-dependencies');

const cliPath = path.join(__dirname, 'runtime-dependencies.js');

function sha256(bytes, isText = false) {
  const source = isText
    ? Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')
    : bytes;
  return crypto.createHash('sha256').update(source).digest('hex');
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'votc-runtime-deps-'));
  const nodeModules = path.join(root, 'resources', 'app', 'node_modules');
  const packageDir = path.join(nodeModules, 'fixture-package');
  fs.mkdirSync(path.join(packageDir, 'build'), { recursive: true });

  const packageJson = Buffer.from(JSON.stringify({
    name: 'fixture-package',
    version: '1.2.3',
    license: 'MIT',
  }, null, 2) + '\n');
  const source = Buffer.from('first line\r\nsecond line\r\n');
  const license = Buffer.from('Fixture license\n');
  const native = Buffer.from([0, 255, 17, 0, 128]);
  const files = [
    { path: 'fixture-package/LICENSE', bytes: license, text: true },
    { path: 'fixture-package/build/addon.node', bytes: native, text: false },
    { path: 'fixture-package/index.js', bytes: source, text: true },
    { path: 'fixture-package/package.json', bytes: packageJson, text: true },
  ];

  for (const file of files) {
    const fullPath = path.join(nodeModules, ...file.path.split('/'));
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, file.bytes);
  }

  const appPackage = JSON.stringify({ dependencies: { 'fixture-package': '1.2.3' } }, null, 2);
  fs.writeFileSync(path.join(root, 'resources', 'app', 'package.json'), appPackage);
  fs.mkdirSync(path.join(root, 'src', 'app'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'app', 'package.json'), appPackage);

  const lock = {
    schemaVersion: 1,
    kind: 'votc-vendored-runtime-dependencies',
    source: 'git ls-files resources/app/node_modules',
    hashPolicy: 'strict-utf8-roundtrip-crlf-to-lf-otherwise-raw-bytes',
    directoryPolicy: 'allow-empty-untracked-directories',
    fileCount: files.length,
    packageCount: 1,
    directDependencies: { 'fixture-package': '1.2.3' },
    packages: [{
      root: 'fixture-package',
      packageJson: 'fixture-package/package.json',
      name: 'fixture-package',
      version: '1.2.3',
      license: 'MIT',
      licenseFiles: ['fixture-package/LICENSE'],
      nativeFiles: ['fixture-package/build/addon.node'],
    }],
    files: files.map(file => ({ path: file.path, sha256: sha256(file.bytes, file.text) })),
  };
  const lockPath = path.join(root, 'build', 'runtime-dependencies.lock.json');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  return { root, nodeModules, lockPath, lock };
}

function withFixture(run) {
  const fixture = createFixture();
  try {
    run(fixture);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

function expectFailure(fixture, pattern) {
  const result = verifyRuntimeDependencies(fixture.root);
  assert.equal(result.ok, false, 'invalid runtime dependency tree must be rejected');
  assert.match(result.errors.join('\n'), pattern);
}

withFixture(fixture => {
  const result = verifyRuntimeDependencies(fixture.root);
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.deepEqual(result.directVersions, { 'fixture-package': '1.2.3' });
  assert.equal(result.fileCount, 4);

  const sourcePath = path.join(fixture.nodeModules, 'fixture-package', 'index.js');
  fs.writeFileSync(sourcePath, 'first line\nsecond line\n');
  assert.equal(verifyRuntimeDependencies(fixture.root).ok, true, 'CRLF and LF text checkouts share a canonical hash');
  fs.mkdirSync(path.join(fixture.nodeModules, 'empty-untracked', 'nested'), { recursive: true });
  assert.equal(verifyRuntimeDependencies(fixture.root).ok, true, 'untracked empty directories are allowed');
});

withFixture(fixture => {
  fs.writeFileSync(path.join(fixture.nodeModules, 'injected.js'), 'unexpected');
  expectFailure(fixture, /unexpected|untracked|extra/i);
});

withFixture(fixture => {
  fs.unlinkSync(path.join(fixture.nodeModules, 'fixture-package', 'index.js'));
  expectFailure(fixture, /missing/i);
});

withFixture(fixture => {
  fs.writeFileSync(path.join(fixture.nodeModules, 'fixture-package', 'index.js'), 'changed');
  expectFailure(fixture, /hash|modified|mismatch/i);
});

withFixture(fixture => {
  fixture.lock.files[0].path = '../outside.txt';
  fs.writeFileSync(fixture.lockPath, JSON.stringify(fixture.lock, null, 2));
  expectFailure(fixture, /path|invalid/i);
});

withFixture(fixture => {
  fixture.lock.directDependencies = {};
  fs.writeFileSync(fixture.lockPath, JSON.stringify(fixture.lock, null, 2));
  expectFailure(fixture, /direct dependency|directDependencies|dependency inventory/i);
});

withFixture(fixture => {
  fixture.lock.directDependencies['fixture-package'] = '1.2.4';
  fs.writeFileSync(fixture.lockPath, JSON.stringify(fixture.lock, null, 2));
  expectFailure(fixture, /version/i);
});

for (const manifestPath of ['resources/app/package.json', 'src/app/package.json']) {
  for (const declaredVersion of ['999.0.0', '^1.2.3']) {
    withFixture(fixture => {
      const fullPath = path.join(fixture.root, ...manifestPath.split('/'));
      const manifest = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      manifest.dependencies['fixture-package'] = declaredVersion;
      fs.writeFileSync(fullPath, JSON.stringify(manifest, null, 2));
      expectFailure(fixture, /dependency declaration version mismatch/i);
    });
  }
}

withFixture(fixture => {
  const result = spawnSync(process.execPath, [cliPath, fixture.root], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS/);
});

console.log('V9.1 runtime dependencies: PASS');
