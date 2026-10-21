"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const REQUIRED_FILES = [
  "VOTC.exe",
  "chrome_100_percent.pak",
  "chrome_200_percent.pak",
  "d3dcompiler_47.dll",
  "ffmpeg.dll",
  "icudtl.dat",
  "libEGL.dll",
  "libGLESv2.dll",
  "resources.pak",
  "snapshot_blob.bin",
  "v8_context_snapshot.bin",
  "vk_swiftshader.dll",
  "vk_swiftshader_icd.json",
  "vulkan-1.dll",
  "locales/en-US.pak",
  "locales/zh-CN.pak",
  "resources/app/package.json",
  "resources/app/out/main/main.js",
  "resources/app/out/preload/preload.js",
  "resources/app/out/renderer/index.html"
];

const REQUIRED_DIRECTORIES = [
  "locales",
  "resources/app/default_userdata",
  "resources/app/node_modules"
];

const POINTER_PREFIX = "version https://git-lfs.github.com/spec/v1";
const STARTUP_TIMEOUT_MS = 30000;
const EXIT_TIMEOUT_MS = 15000;
const MAX_CAPTURE_BYTES = 8192;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseArgs(argv) {
  const repositoryRoot = path.resolve(__dirname, "..");
  const options = {
    appDir: repositoryRoot,
    launch: false,
    keepTemp: false,
    enableLogging: false,
    compareSource: false,
    tempRoot: path.join(repositoryRoot, ".build", "v9.4-construction", "smoke-temp")
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--app-dir") {
      if (!argv[index + 1]) throw new Error("--app-dir requires a directory path");
      options.appDir = path.resolve(argv[++index]);
    } else if (arg === "--launch") {
      options.launch = true;
    } else if (arg === "--keep-temp") {
      options.keepTemp = true;
    } else if (arg === "--enable-logging") {
      options.enableLogging = true;
    } else if (arg === "--compare-source") {
      options.compareSource = true;
    } else if (arg === "--temp-root") {
      if (!argv[index + 1]) throw new Error("--temp-root requires a directory path");
      options.tempRoot = path.resolve(argv[++index]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.compareSource && !options.launch) throw new Error("--compare-source requires --launch");
  return options;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function portablePath(value) {
  return value.split(path.sep).join("/");
}

function isWithin(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function isTopLevelRuntimeFile(name) {
  return name === "VOTC.exe"
    || name === "Uninstall VOTC.exe"
    || name === "vk_swiftshader_icd.json"
    || /^LICENSE(?:S)?\.(?:txt|html)$/i.test(name)
    || /\.(?:dll|pak|bin|dat)$/i.test(name);
}

function collectRuntimeFiles(root) {
  const files = [];
  const seen = new Set();
  const addFile = relativePath => {
    const normalized = portablePath(relativePath);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      files.push(normalized);
    }
  };

  function walk(relativeDirectory) {
    const absoluteDirectory = path.join(root, relativeDirectory);
    for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Package contains a symbolic link: ${portablePath(relativePath)}`);
      if (entry.isDirectory()) walk(relativePath);
      else if (entry.isFile()) addFile(relativePath);
    }
  }

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`Package root contains a symbolic link: ${entry.name}`);
    if (entry.isFile() && isTopLevelRuntimeFile(entry.name)) addFile(entry.name);
  }
  for (const relativeDirectory of ["locales", "resources"]) {
    const absoluteDirectory = path.join(root, relativeDirectory);
    if (fs.existsSync(absoluteDirectory)) walk(relativeDirectory);
  }
  return files.sort(compareText);
}

async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function isLfsPointer(filePath) {
  const descriptor = fs.openSync(filePath, "r");
  try {
    const prefix = Buffer.alloc(128);
    const bytesRead = fs.readSync(descriptor, prefix, 0, prefix.length, 0);
    return prefix.subarray(0, bytesRead).toString("utf8").startsWith(POINTER_PREFIX);
  } finally {
    fs.closeSync(descriptor);
  }
}

async function fingerprint(root, relativeFiles) {
  const rows = [];
  const batchSize = 24;
  for (let start = 0; start < relativeFiles.length; start += batchSize) {
    const batch = relativeFiles.slice(start, start + batchSize);
    rows.push(...await Promise.all(batch.map(async relativePath => {
      const filePath = path.join(root, relativePath);
      const stat = fs.statSync(filePath);
      return { path: relativePath, sizeBytes: stat.size, sha256: await hashFile(filePath), lfsPointer: isLfsPointer(filePath) };
    })));
  }
  const aggregate = crypto.createHash("sha256");
  let totalBytes = 0;
  for (const row of rows) {
    totalBytes += row.sizeBytes;
    aggregate.update(`${row.path}\0${row.sizeBytes}\0${row.sha256}\n`, "utf8");
  }
  return { fileCount: rows.length, totalBytes, treeSha256: aggregate.digest("hex"), rows };
}

async function inspectDistribution(appDir) {
  const failures = [];
  if (!fs.existsSync(appDir) || !fs.statSync(appDir).isDirectory()) {
    return { status: "FAIL", failures: [`App directory not found: ${appDir}`] };
  }

  for (const relativePath of REQUIRED_FILES) {
    const fullPath = path.join(appDir, relativePath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile() || fs.statSync(fullPath).size === 0) {
      failures.push(`Missing or empty required file: ${relativePath}`);
    }
  }
  for (const relativePath of REQUIRED_DIRECTORIES) {
    const fullPath = path.join(appDir, relativePath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) failures.push(`Missing required directory: ${relativePath}`);
  }

  let packageMetadata = null;
  const packagePath = path.join(appDir, "resources", "app", "package.json");
  if (fs.existsSync(packagePath)) {
    try {
      packageMetadata = JSON.parse(fs.readFileSync(packagePath, "utf8"));
      const mainEntry = packageMetadata.main || "out/main/index.js";
      if (!fs.existsSync(path.join(appDir, "resources", "app", mainEntry))) failures.push(`Package main entry is missing: resources/app/${mainEntry}`);
      if (typeof packageMetadata.version !== "string") failures.push("resources/app/package.json is missing a string version");
      for (const dependencyName of Object.keys(packageMetadata.dependencies || {})) {
        const dependencyPath = path.join(appDir, "resources", "app", "node_modules", dependencyName);
        if (!fs.existsSync(dependencyPath)) failures.push(`Missing packaged dependency: ${dependencyName}`);
      }
    } catch (error) {
      failures.push(`Invalid resources/app/package.json: ${error.message}`);
    }
  }

  let files = [];
  let manifest = null;
  try {
    files = collectRuntimeFiles(appDir);
    if (!files.includes("VOTC.exe")) failures.push("Runtime payload does not include VOTC.exe");
    if (!files.some(file => file.startsWith("locales/"))) failures.push("Runtime payload contains no locale files");
    if (!files.some(file => file.startsWith("resources/app/"))) failures.push("Runtime payload contains no resources/app files");
    manifest = await fingerprint(appDir, files);
    const pointerRows = manifest.rows.filter(row => row.lfsPointer);
    for (const row of pointerRows) failures.push(`Unhydrated Git LFS pointer: ${row.path}`);
  } catch (error) {
    failures.push(`Unable to inventory complete runtime payload: ${error.message}`);
  }

  return {
    status: failures.length ? "FAIL" : "PASS",
    failures,
    appDir,
    package: packageMetadata && { name: packageMetadata.name, productName: packageMetadata.productName, version: packageMetadata.version, main: packageMetadata.main },
    requiredFileCount: REQUIRED_FILES.length,
    localePakCount: files.filter(file => /^locales\/.*\.pak$/i.test(file)).length,
    files: manifest && {
      fileCount: manifest.fileCount,
      totalBytes: manifest.totalBytes,
      treeSha256: manifest.treeSha256,
      criticalFiles: manifest.rows.filter(row => REQUIRED_FILES.includes(row.path)).map(({ path: relativePath, sizeBytes, sha256, lfsPointer }) => ({ path: relativePath, sizeBytes, sha256, lfsPointer }))
    }
  };
}

function createIsolatedEnvironment(profileDir) {
  const driveRoot = path.parse(profileDir).root;
  const env = {
    ...process.env,
    APPDATA: profileDir,
    LOCALAPPDATA: profileDir,
    USERPROFILE: profileDir,
    HOMEDRIVE: driveRoot.slice(0, 2),
    HOMEPATH: profileDir.slice(driveRoot.length) || "\\",
    TEMP: profileDir,
    TMP: profileDir
  };
  const removedCredentialVariableNames = [];
  for (const name of Object.keys(env)) {
    if (/(?:API[_-]?KEY|(?:^|_)KEY(?:_|$)|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTHORIZATION)/i.test(name)
      || /^(?:NODE_OPTIONS|ELECTRON_RUN_AS_NODE|DEBUG_VERBOSE_LLM|VOTC_)/i.test(name)) {
      delete env[name];
      removedCredentialVariableNames.push(name);
    }
  }
  return { env, removedCredentialVariableNames: removedCredentialVariableNames.sort(compareText) };
}

function redactAndBoundOutput(value) {
  let output = String(value || "")
    .replace(/\b(Bearer\s+)\S+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|credential)\b[ \t]*[:=][ \t]*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1[REDACTED]")
    .replace(/([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|key)=)[^&#\s]+/gi, "$1[REDACTED]");
  const bytes = Buffer.from(output, "utf8");
  if (bytes.length > MAX_CAPTURE_BYTES) output = bytes.subarray(bytes.length - MAX_CAPTURE_BYTES).toString("utf8");
  return output;
}

function connectCdp(webSocketUrl, errors) {
  if (typeof WebSocket !== "function") throw new Error("This Node runtime has no built-in WebSocket; use Node 22.4 or newer for --launch");
  const socket = new WebSocket(webSocketUrl);
  const requests = new Map();
  let sequence = 0;
  socket.addEventListener("message", event => {
    let message;
    try { message = JSON.parse(event.data); } catch (_error) { return; }
    if (message.method === "Runtime.exceptionThrown") {
      errors.push(true);
    }
    const pending = requests.get(message.id);
    if (!pending) return;
    requests.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(`${pending.method}: ${JSON.stringify(message.error)}`));
    else pending.resolve(message.result);
  });
  return new Promise((resolve, reject) => {
    const fail = error => reject(new Error(`CDP connection failed: ${error?.message || "socket error"}`));
    socket.addEventListener("open", () => {
      const send = (method, params = {}) => new Promise((sendResolve, sendReject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          requests.delete(id);
          sendReject(new Error(`CDP timeout: ${method}`));
        }, 10000);
        requests.set(id, { method, resolve: sendResolve, reject: sendReject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
      const evaluate = async expression => {
        const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || "CDP evaluation failed");
        return response.result?.value;
      };
      resolve({ send, evaluate, socket });
    }, { once: true });
    socket.addEventListener("error", fail, { once: true });
  });
}

function waitForOutput(child, expression, timeoutMs, readOutput) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${expression}`)), timeoutMs);
    const inspect = text => {
      const match = (readOutput() || text).match(expression);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    const onExit = (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`VOTC.exe exited before debug endpoint (code=${code}, signal=${signal})`));
    };
    const onError = error => {
      clearTimeout(timer);
      reject(new Error(`Unable to start VOTC.exe: ${error.message}`));
    };
    child.on("exit", onExit);
    child.on("error", onError);
    child.stdout.on("data", chunk => inspect(String(chunk)));
    child.stderr.on("data", chunk => inspect(String(chunk)));
  });
}

function startPackagedApp(appDir, profileDir, options = {}) {
  const isolated = createIsolatedEnvironment(profileDir);
  const args = [
    `--user-data-dir=${profileDir}`,
    "--remote-debugging-port=0",
    "--inspect=127.0.0.1:0"
  ];
  if (options.enableLogging) args.push("--enable-logging=stderr");
  const child = spawn(path.join(appDir, "VOTC.exe"), args, {
    cwd: appDir,
    windowsHide: true,
    env: isolated.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdoutTail = "";
  let stderrTail = "";
  let outputTail = "";
  const appendTail = (current, chunk, limit) => {
    const bytes = Buffer.concat([Buffer.from(current, "utf8"), Buffer.from(chunk)]);
    return bytes.subarray(Math.max(0, bytes.length - limit)).toString("utf8");
  };
  child.stdout.on("data", chunk => {
    stdoutTail = appendTail(stdoutTail, chunk, MAX_CAPTURE_BYTES);
    outputTail = appendTail(outputTail, chunk, MAX_CAPTURE_BYTES * 2);
  });
  child.stderr.on("data", chunk => {
    stderrTail = appendTail(stderrTail, chunk, MAX_CAPTURE_BYTES);
    outputTail = appendTail(outputTail, chunk, MAX_CAPTURE_BYTES * 2);
  });
  return {
    child,
    outputTail: () => outputTail,
    captureOutput: () => ({ stdout: redactAndBoundOutput(stdoutTail), stderr: redactAndBoundOutput(stderrTail) }),
    removedCredentialVariableNames: isolated.removedCredentialVariableNames
  };
}

async function listRendererTargets(browserEndpoint) {
  const origin = new URL(browserEndpoint).origin.replace("ws:", "http:");
  const response = await fetch(`${origin}/json/list`);
  if (!response.ok) throw new Error(`DevTools target list returned HTTP ${response.status}`);
  return response.json();
}

async function inspectOneLaunch(appDir, profileDir, expectedVersion, passNumber, options = {}) {
  const { child, outputTail, captureOutput, removedCredentialVariableNames } = startPackagedApp(appDir, profileDir, options);
  let main = null;
  let renderer = null;
  let settledExit = null;
  let launchResult = null;
  let launchFailure = null;
  child.once("exit", (code, signal) => { settledExit = { code, signal }; });
  const errors = [];
  try {
    const [browserEndpoint, mainEndpoint] = await Promise.all([
      waitForOutput(child, /DevTools listening on (ws:\/\/[^\s]+)/, STARTUP_TIMEOUT_MS, outputTail),
      waitForOutput(child, /Debugger listening on (ws:\/\/[^\s]+)/, STARTUP_TIMEOUT_MS, outputTail)
    ]);
    main = await connectCdp(mainEndpoint, errors);
    await main.send("Runtime.enable");
    const readMainInfo = () => main.evaluate(`(() => {
      const electron = process.mainModule.require("electron");
      const windows = electron.BrowserWindow.getAllWindows().filter(window => !window.isDestroyed());
      return {
        pid: process.pid,
        processType: process.type,
        electronVersion: process.versions.electron,
        appReady: electron.app.isReady(),
        appVersion: electron.app.getVersion(),
        appLocale: electron.app.getLocale(),
        appPath: electron.app.getAppPath(),
        userDataPath: electron.app.getPath("userData"),
        windows: windows.map(window => ({ id: window.id, pid: window.webContents.getOSProcessId(), url: window.webContents.getURL(), loading: window.webContents.isLoading() }))
      };
    })()`);
    const mainDeadline = Date.now() + STARTUP_TIMEOUT_MS;
    let mainInfo = null;
    while (Date.now() < mainDeadline) {
      if (settledExit) throw new Error(`VOTC.exe exited before the main window was created (${JSON.stringify(settledExit)})`);
      mainInfo = await readMainInfo();
      if (mainInfo?.processType === "browser" && mainInfo.appReady && mainInfo.windows.length > 0) break;
      await delay(100);
    }
    if (!mainInfo || mainInfo.processType !== "browser" || !mainInfo.appReady || !mainInfo.windows.length) throw new Error("Electron main process did not become ready with a BrowserWindow");
    if (mainInfo.appVersion !== expectedVersion) throw new Error(`Running app version ${mainInfo.appVersion} does not match package version ${expectedVersion}`);
    if (!isWithin(path.join(appDir, "resources", "app"), mainInfo.appPath)) throw new Error("Electron app path escaped the isolated complete distribution copy");
    if (!isWithin(profileDir, mainInfo.userDataPath)) throw new Error("Electron userData path escaped the isolated profile");

    const browserTargetsDeadline = Date.now() + STARTUP_TIMEOUT_MS;
    let pageTarget = null;
    const expectedRendererUrl = pathToFileURL(path.join(appDir, "resources", "app", "out", "renderer", "index.html")).href.toLowerCase();
    while (!pageTarget && Date.now() < browserTargetsDeadline) {
      if (settledExit) throw new Error(`VOTC.exe exited before renderer startup (${JSON.stringify(settledExit)})`);
      const targets = await listRendererTargets(browserEndpoint);
      pageTarget = targets.find(target => target.type === "page" && target.webSocketDebuggerUrl && (target.url || "").toLowerCase().startsWith(expectedRendererUrl));
      if (!pageTarget) await delay(100);
    }
    if (!pageTarget) throw new Error("Electron renderer DevTools page target was not created");
    renderer = await connectCdp(pageTarget.webSocketDebuggerUrl, errors);
    await renderer.send("Runtime.enable");
    await renderer.send("Page.enable");

    const rendererDeadline = Date.now() + STARTUP_TIMEOUT_MS;
    let rendererInfo = null;
    while (!rendererInfo && Date.now() < rendererDeadline) {
      if (settledExit) throw new Error(`VOTC.exe exited before renderer became ready (${JSON.stringify(settledExit)})`);
      const candidate = await renderer.evaluate(`({
        readyState: document.readyState,
        url: location.href,
        bodyTextLength: document.body?.innerText?.length || 0,
        hasPreloadIpcBridge: typeof globalThis.electronAPI?.getAppVersion === "function"
      })`);
      if (candidate?.readyState === "complete" && candidate.bodyTextLength > 30 && candidate.hasPreloadIpcBridge) rendererInfo = candidate;
      else await delay(100);
    }
    if (!rendererInfo) throw new Error("Renderer did not load with the expected preload bridge");

    const ipcVersion = await renderer.evaluate("electronAPI.getAppVersion()");
    if (ipcVersion !== expectedVersion) throw new Error(`Read-only app:getVersion IPC returned ${String(ipcVersion)}`);
    await delay(2000);
    if (settledExit) throw new Error(`VOTC.exe exited during the cold-start stability window (${JSON.stringify(settledExit)})`);
    if (errors.length) throw new Error(`Electron reported ${errors.length} unhandled runtime exception(s) during startup`);
    const ffmpeg = await inspectLoadedFfmpeg(
      [mainInfo.pid, ...mainInfo.windows.map(window => window.pid)],
      path.join(appDir, "ffmpeg.dll")
    );
    const appLocale = mainInfo.appLocale;
    const localeCandidate = appLocale && path.join(appDir, "locales", `${appLocale}.pak`);
    const localePak = localeCandidate && fs.existsSync(localeCandidate)
      ? { status: "MATCHING_PAK_PRESENT", path: path.relative(appDir, localeCandidate).split(path.sep).join("/") }
      : { status: "NO_MATCHING_PAK", fallbackEnUsPresent: fs.existsSync(path.join(appDir, "locales", "en-US.pak")) };

    await main.evaluate("setImmediate(() => process.mainModule.require('electron').app.quit()); true");
    if (renderer.socket.readyState === WebSocket.OPEN) renderer.socket.close();
    renderer = null;
    if (main.socket.readyState === WebSocket.OPEN) main.socket.close();
    main = null;
    const exitDeadline = Date.now() + EXIT_TIMEOUT_MS;
    while (!settledExit && Date.now() < exitDeadline) await delay(100);
    if (!settledExit) throw new Error("VOTC.exe did not exit after app.quit() within the shutdown timeout");
    if (settledExit.code !== 0 || settledExit.signal) throw new Error(`VOTC.exe exited abnormally after app.quit(): ${JSON.stringify(settledExit)}`);

    launchResult = {
      status: "PASS",
      passNumber,
      pid: mainInfo.pid,
      processType: mainInfo.processType,
      electronVersion: mainInfo.electronVersion,
      appVersion: mainInfo.appVersion,
      appPath: mainInfo.appPath,
      userDataPath: mainInfo.userDataPath,
      renderer: { url: rendererInfo.url, readyState: rendererInfo.readyState, bodyTextLength: rendererInfo.bodyTextLength },
      preload: { bridge: "electronAPI.getAppVersion", present: true },
      ipc: { invocation: "electronAPI.getAppVersion() -> app:getVersion", returnedVersion: ipcVersion },
      runtimeResources: { ffmpeg, appLocale, localePak },
      shutdown: { method: "Electron app.quit()", exit: settledExit },
      removedCredentialVariableNames,
      runtimeExceptionCount: errors.length,
      processOutput: captureOutput()
    };
  } catch (error) {
    launchFailure = error;
  } finally {
    if (renderer?.socket.readyState === WebSocket.OPEN) renderer.socket.close();
    if (main && child.exitCode === null) {
      try { await main.evaluate("setImmediate(() => process.mainModule.require('electron').app.quit()); true"); } catch (_error) {}
    }
    if (main?.socket.readyState === WebSocket.OPEN) main.socket.close();
    const exited = settledExit || await Promise.race([
      new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal }))),
      delay(EXIT_TIMEOUT_MS).then(() => null)
    ]);
    if (!exited && child.exitCode === null) await stopOwnedProcessTree(child);
    if (child.exitCode === null && child.signalCode === null) await delay(250);
  }
  if (launchFailure) {
    launchFailure.launchDiagnostics = {
      status: "FAIL",
      passNumber,
      executable: path.join(appDir, "VOTC.exe"),
      workingDirectory: appDir,
      profileDirectory: profileDir,
      exit: settledExit || (child.exitCode !== null || child.signalCode !== null ? { code: child.exitCode, signal: child.signalCode } : null),
      processOutput: captureOutput()
    };
    throw launchFailure;
  }
  return launchResult;
}

function inspectLoadedFfmpeg(processIds, expectedPath) {
  const uniqueIds = [...new Set(processIds.filter(Number.isInteger))];
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$processIds = @(${uniqueIds.join(",")})`,
    "$paths = @()",
    "foreach ($processId in $processIds) {",
    "  try {",
    "    $target = Get-Process -Id $processId -ErrorAction Stop",
    "    foreach ($module in $target.Modules) { if ($module.ModuleName -ieq 'ffmpeg.dll') { $paths += $module.FileName } }",
    "  } catch {",
    "    if ($_.Exception.Message -match 'access is denied|error 5|win32exception') { [Console]::Error.Write('ACCESS_DENIED'); exit 5 }",
    "    [Console]::Error.Write('MODULE_QUERY_ERROR'); exit 6",
    "  }",
    "}",
    "[Console]::Out.Write([string]::Join([Environment]::NewLine, $paths))"
  ].join("; ");
  let result;
  try {
    result = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (_error) {
    return { status: "QUERY_UNAVAILABLE" };
  }
  let stdout = "";
  let stderr = "";
  result.stdout.on("data", chunk => { stdout += String(chunk); });
  result.stderr.on("data", chunk => { stderr += String(chunk); });
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      result.kill();
      resolve({ status: "QUERY_TIMEOUT" });
    }, 5000);
    result.once("error", () => {
      clearTimeout(timer);
      resolve({ status: "QUERY_UNAVAILABLE" });
    });
    result.once("exit", code => {
      clearTimeout(timer);
      if (code === 5 || stderr.includes("ACCESS_DENIED")) resolve({ status: "ACCESS_DENIED" });
      else if (code !== 0) resolve({ status: "QUERY_ERROR" });
      else {
        const paths = stdout.split(/\r?\n/).filter(Boolean);
        const expected = path.resolve(expectedPath).toLowerCase();
        const packagePath = paths.find(filePath => path.resolve(filePath).toLowerCase() === expected);
        resolve(packagePath
          ? { status: "LOADED", path: packagePath }
          : paths.length ? { status: "LOADED_OUTSIDE_DISTRIBUTION", paths } : { status: "NOT_LOADED" });
      }
    });
  });
}

async function stopOwnedProcessTree(child) {
  if (process.platform === "win32" && Number.isInteger(child.pid)) {
    await new Promise(resolve => {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      killer.once("error", () => resolve());
      killer.once("exit", () => resolve());
    });
  } else {
    child.kill();
  }
}

function writeEvidence(evidencePath, evidence) {
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

function usage() {
  return [
    "Usage: node scripts/test-v9.4-windows-packaged-smoke.js [options]",
    "",
    "  --app-dir <path>  Complete Electron distribution root (default: repository root)",
    "  --launch          Explicitly copy and launch VOTC.exe twice with isolated profiles",
    "  --enable-logging  Add Electron --enable-logging=stderr for local diagnostics",
    "  --compare-source  Also launch the source directory once with a separate blank profile",
    "  --temp-root <path> Keep launch scratch data under repository .build (default: .build/v9.4-construction/smoke-temp)",
    "  --keep-temp       Keep the copied distribution and isolated profiles after launch",
    "  --help            Show this help",
    "",
    "Without --launch this performs static completeness, LFS-pointer and SHA-256 checks only.",
    "Launch evidence contains separately bounded and redacted stdout/stderr tails."
  ].join("\n");
}

async function run(options) {
  if (options.help) {
    console.log(usage());
    return 0;
  }
  const evidence = {
    schema: "votc-v9.4-windows-packaged-smoke/v1",
    mode: options.launch ? "PACKAGED_LAUNCH" : "STATIC_PACKAGE_CHECK",
    nodeVersion: process.version,
    createdAt: new Date().toISOString(),
    static: null,
    packagedLaunch: { status: options.launch ? "NOT_RUN" : "NOT_REQUESTED", launches: [] },
    manualDesktopUi: { status: "NOT_RUN", items: ["input focus and typed draft persistence", "transparent empty-area click-through"] },
    failures: []
  };
  let scratchRoot = null;
  let evidencePath = null;
  try {
    const staticResult = await inspectDistribution(options.appDir);
    evidence.static = staticResult;
    if (staticResult.status !== "PASS") evidence.failures.push(...staticResult.failures);
    if (!options.launch || staticResult.status !== "PASS") return evidence.failures.length ? 1 : 0;

    if (process.platform !== "win32") throw new Error("--launch is a Windows-only packaged gate");
    const buildRoot = path.resolve(__dirname, "..", ".build");
    const tempRoot = path.resolve(options.tempRoot);
    if (!isWithin(buildRoot, tempRoot)) throw new Error(`Launch scratch data must stay under ${buildRoot}`);
    fs.mkdirSync(tempRoot, { recursive: true });
    scratchRoot = fs.mkdtempSync(path.join(tempRoot, "votc-v94-windows-smoke-"));
    evidencePath = path.join(scratchRoot, "evidence.json");
    const distributionRoot = path.join(scratchRoot, "distribution");
    const profileRoot = path.join(scratchRoot, "profile");
    fs.mkdirSync(distributionRoot, { recursive: true });
    fs.mkdirSync(profileRoot, { recursive: true });
    for (const relativePath of collectRuntimeFiles(options.appDir)) {
      const sourcePath = path.join(options.appDir, relativePath);
      const targetPath = path.join(distributionRoot, relativePath);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
    }
    const copied = await inspectDistribution(distributionRoot);
    evidence.copy = { status: copied.status, treeSha256: copied.files?.treeSha256, fileCount: copied.files?.fileCount, totalBytes: copied.files?.totalBytes };
    if (copied.status !== "PASS" || copied.files.treeSha256 !== staticResult.files.treeSha256) {
      throw new Error("The isolated full runtime copy failed completeness or SHA-256 parity verification");
    }

    evidence.packagedLaunch = {
      status: "IN_PROGRESS",
      launches: [],
      distributionRoot,
      profileRoot,
      loggingEnabled: options.enableLogging,
      sourceComparison: options.compareSource ? { status: "NOT_RUN" } : { status: "NOT_REQUESTED" }
    };
    const expectedVersion = staticResult.package.version;
    let copiedLaunchFailure = null;
    try {
      evidence.packagedLaunch.launches.push(await inspectOneLaunch(distributionRoot, profileRoot, expectedVersion, 1, options));
      evidence.packagedLaunch.launches.push(await inspectOneLaunch(distributionRoot, profileRoot, expectedVersion, 2, options));
      const missingFfmpegLoad = evidence.packagedLaunch.launches.some(launch => launch.runtimeResources.ffmpeg.status !== "LOADED");
      const missingLocalePack = evidence.packagedLaunch.launches.some(launch => launch.runtimeResources.localePak.status !== "MATCHING_PAK_PRESENT");
      evidence.packagedLaunch.status = missingFfmpegLoad || missingLocalePack ? "PARTIAL" : "PASS";
      evidence.packagedLaunch.restart = { priorPid: evidence.packagedLaunch.launches[0].pid, newPid: evidence.packagedLaunch.launches[1].pid, sameIsolatedProfile: true, firstExitClean: evidence.packagedLaunch.launches[0].shutdown.exit.code === 0 };
      if (missingFfmpegLoad) evidence.packagedLaunch.failures = ["ffmpeg.dll load could not be confirmed in the inspected app processes"];
      if (missingLocalePack) evidence.packagedLaunch.failures = [...(evidence.packagedLaunch.failures || []), "The selected app locale has no matching locales/*.pak file"];
    } catch (error) {
      copiedLaunchFailure = error;
      evidence.packagedLaunch.status = "FAIL";
      evidence.packagedLaunch.failures = [error.message];
      if (error.launchDiagnostics) evidence.packagedLaunch.launches.push({ ...error.launchDiagnostics, failure: error.message });
      if (!options.compareSource) throw error;
    }

    if (options.compareSource) {
      const sourceProfileRoot = path.join(scratchRoot, "source-profile");
      fs.mkdirSync(sourceProfileRoot, { recursive: true });
      try {
        evidence.packagedLaunch.sourceComparison = await inspectOneLaunch(options.appDir, sourceProfileRoot, expectedVersion, "original-directory", options);
      } catch (error) {
        evidence.packagedLaunch.sourceComparison = {
          ...(error.launchDiagnostics || { status: "FAIL", passNumber: "original-directory" }),
          failure: error.message
        };
      }
    }

    if (copiedLaunchFailure) return 1;
    return evidence.packagedLaunch.status === "PASS" ? 0 : 1;
  } catch (error) {
    evidence.failures.push(error.message);
    if (options.launch) evidence.packagedLaunch.status = "FAIL";
    return 1;
  } finally {
    if (evidencePath) {
      evidence.evidencePath = evidencePath;
      try { writeEvidence(evidencePath, evidence); } catch (error) { evidence.failures.push(`Unable to save evidence: ${error.message}`); }
      if (!options.keepTemp && !options.compareSource && evidence.packagedLaunch.launches.length === 2 && evidence.packagedLaunch.launches.every(launch => launch.shutdown?.exit?.code === 0)) {
        for (const relativePath of ["distribution", "profile"]) {
          const targetPath = path.join(scratchRoot, relativePath);
          if (isWithin(scratchRoot, targetPath)) fs.rmSync(targetPath, { recursive: true, force: true });
        }
        evidence.tempPayloadsRemoved = true;
        try { writeEvidence(evidencePath, evidence); } catch (_error) {}
      }
    }
    console.log(JSON.stringify(evidence, null, 2));
  }
}

Promise.resolve().then(() => run(parseArgs(process.argv.slice(2)))).then(code => { process.exitCode = code; }).catch(error => {
  console.error(`V9.4 Windows packaged smoke: FAIL (${error.message})`);
  console.error(usage());
  process.exitCode = 1;
});
