"use strict";

const DEFAULT_LANGUAGE = "simp_chinese";
const TYPE_FILE_PATTERNS = Object.freeze({
  title: /title/i,
  character: /(name|character)/i,
  dynasty: /dynast/i,
  culture: /culture/i,
  faith: /(faith|religion)/i,
  war: /war/i
});
const MAX_FILES_PER_LOOKUP = 5000;
const MAX_DISPLAY_FILES_PER_LOOKUP = 250;

function rawResult(rawKey, language, confidence, extra = {}) {
  return {
    localizedValue: rawKey,
    rawKey,
    language,
    sourceFile: null,
    sourceMod: null,
    confidence,
    ...extra
  };
}

function normalizeKey(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 240) return null;
  return value.trim();
}

function parseDescriptor(text) {
  const pathMatch = text.match(/^\s*path\s*=\s*"([^"]+)"/m);
  const idMatch = text.match(/^\s*remote_file_id\s*=\s*"?(\d+)"?/m);
  return { root: pathMatch?.[1] || null, modId: idMatch?.[1] || null };
}

function parseLocalizationLine(line, rawKey) {
  const match = line.match(/^\s*([^\s:#]+):\s*(?:\d+\s*)?"((?:\\.|[^"])*)"\s*(?:#.*)?$/);
  if (!match || match[1] !== rawKey) return null;
  return match[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function parseAnyLocalizationLine(line) {
  const match = line.match(/^\s*([^\s:#]+):\s*(?:\d+\s*)?"((?:\\.|[^"])*)"\s*(?:#.*)?$/);
  return match ? { rawKey: match[1], value: match[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\") } : null;
}

function isStaticValue(value) {
  return !!value && !/[\[\]$]/.test(value);
}

class CK3LocalizationResolver {
  constructor({ fs, path, getCK3UserFolderPath, language = DEFAULT_LANGUAGE } = {}) {
    if (!fs || !path) throw new Error("localization_fs_path_required");
    this.fs = fs;
    this.path = path;
    this.getCK3UserFolderPath = typeof getCK3UserFolderPath === "function" ? getCK3UserFolderPath : () => null;
    this.language = language;
    this.cache = new Map();
    this.localizationFiles = new Map();
    this.sourceState = null;
  }

  invalidate() {
    this.cache.clear();
    this.localizationFiles.clear();
    this.sourceState = null;
  }

  _sourceSignature(userFolder) {
    const loadPath = userFolder ? this.path.join(userFolder, "dlc_load.json") : null;
    try {
      const stat = loadPath && this.fs.statSync(loadPath);
      return `${userFolder || ""}:${stat?.size || 0}:${stat?.mtimeMs || 0}`;
    } catch (_error) {
      return `${userFolder || ""}:unavailable`;
    }
  }

  _baseGameRootFromModRoot(modRoot) {
    const parts = this.path.resolve(modRoot).split(this.path.sep);
    const steamappsIndex = parts.findIndex((part) => part.toLowerCase() === "steamapps");
    if (steamappsIndex < 0) return null;
    return this.path.join(parts.slice(0, steamappsIndex + 1).join(this.path.sep), "common", "Crusader Kings III", "game");
  }

  _discoverSources() {
    const userFolder = this.getCK3UserFolderPath() || null;
    const signature = this._sourceSignature(userFolder);
    if (this.sourceState?.signature === signature) return this.sourceState;
    const sources = [];
    const missingDescriptors = [];
    let complete = !!userFolder;
    let baseGameRoot = null;
    try {
      const load = JSON.parse(this.fs.readFileSync(this.path.join(userFolder, "dlc_load.json"), "utf8"));
      const enabledMods = Array.isArray(load.enabled_mods) ? load.enabled_mods : [];
      for (const relativeDescriptor of enabledMods) {
        if (typeof relativeDescriptor !== "string" || !relativeDescriptor) continue;
        const descriptorPath = this.path.resolve(userFolder, relativeDescriptor);
        if (!this.fs.existsSync(descriptorPath)) {
          missingDescriptors.push(relativeDescriptor);
          complete = false;
          continue;
        }
        const descriptor = parseDescriptor(this.fs.readFileSync(descriptorPath, "utf8"));
        if (!descriptor.root || !this.fs.existsSync(descriptor.root)) {
          missingDescriptors.push(relativeDescriptor);
          complete = false;
          continue;
        }
        const root = this.path.resolve(descriptor.root);
        const inferredBaseGameRoot = this._baseGameRootFromModRoot(root);
        if (!baseGameRoot && inferredBaseGameRoot && this.fs.existsSync(inferredBaseGameRoot)) baseGameRoot = inferredBaseGameRoot;
        sources.push({ root, sourceMod: descriptor.modId, sourceType: "mod" });
      }
    } catch (_error) {
      complete = false;
    }
    if (baseGameRoot && this.fs.existsSync(baseGameRoot)) sources.unshift({ root: baseGameRoot, sourceMod: null, sourceType: "base_game" });
    else complete = false;
    this.sourceState = { signature, sources, complete, missingDescriptors };
    this.cache.clear();
    this.localizationFiles.clear();
    return this.sourceState;
  }

  _localizationFiles(source) {
    const cacheKey = `${source.root}:${this.language}`;
    if (this.localizationFiles.has(cacheKey)) return this.localizationFiles.get(cacheKey);
    const localizationRoot = this.path.join(source.root, "localization", this.language);
    if (!this.fs.existsSync(localizationRoot)) return [];
    const files = [];
    const pending = [localizationRoot];
    while (pending.length) {
      const current = pending.pop();
      for (const entry of this.fs.readdirSync(current, { withFileTypes: true })) {
        const fullPath = this.path.join(current, entry.name);
        if (entry.isDirectory()) pending.push(fullPath);
        else if (entry.isFile() && entry.name.toLowerCase().endsWith(".yml")) files.push(fullPath);
      }
    }
    const sorted = files.sort((left, right) => left.localeCompare(right));
    this.localizationFiles.set(cacheKey, sorted);
    return sorted;
  }

  _candidateFiles(source, type, fallback = false) {
    const pattern = TYPE_FILE_PATTERNS[type];
    if (!pattern) return [];
    const files = this._localizationFiles(source);
    return fallback ? files.filter((filePath) => !pattern.test(filePath)) : files.filter((filePath) => pattern.test(filePath));
  }

  _findMatches(type, rawKey, state, { includeFallback = true, maxFiles = MAX_FILES_PER_LOOKUP } = {}) {
    const matches = [];
    let scanned = 0;
    let limitReached = false;
    const scan = (fallback) => {
      for (const source of state.sources) {
        for (const filePath of this._candidateFiles(source, type, fallback)) {
          if (scanned >= maxFiles) {
            limitReached = true;
            return;
          }
          scanned += 1;
          let text;
          try {
            text = this.fs.readFileSync(filePath, "utf8");
          } catch (_error) {
            continue;
          }
          let value = null;
          for (const line of text.split(/\r?\n/)) {
            const parsed = parseLocalizationLine(line.replace(/^\uFEFF/, ""), rawKey);
            if (parsed !== null) {
              value = parsed;
              break;
            }
          }
          if (value !== null) matches.push({ value, sourceFile: this.path.relative(source.root, filePath).replaceAll(this.path.sep, "/"), sourceMod: source.sourceMod, sourceType: source.sourceType });
        }
      }
    };
    scan(false);
    if (includeFallback && !matches.length && !limitReached) scan(true);
    return { matches, scanned, limitReached };
  }

  _findRawKeys(type, localizedValue, state, typedOnly = false, matchMode = "exact") {
    const rawKeys = new Set();
    let scanned = 0;
    let limitReached = false;
    const scan = (fallback) => {
      for (const source of state.sources) {
        for (const filePath of this._candidateFiles(source, type, fallback)) {
          if (scanned >= MAX_FILES_PER_LOOKUP) {
            limitReached = true;
            return;
          }
          scanned += 1;
          let text;
          try {
            text = this.fs.readFileSync(filePath, "utf8");
          } catch (_error) {
            continue;
          }
          if (!text.includes(localizedValue)) continue;
          for (const line of text.split(/\r?\n/)) {
            const parsed = parseAnyLocalizationLine(line.replace(/^\uFEFF/, ""));
            const valueMatches = matchMode === "prefix" ? parsed?.value?.startsWith(localizedValue) : parsed?.value === localizedValue;
            if (valueMatches && isStaticValue(parsed.value)) rawKeys.add(parsed.rawKey);
          }
        }
      }
    };
    scan(false);
    if (!typedOnly && !rawKeys.size && !limitReached) scan(true);
    return { rawKeys: [...rawKeys], scannedFiles: scanned, limitReached };
  }

  resolve(type, value) {
    const rawKey = normalizeKey(value);
    if (!rawKey) return rawResult(value ?? null, this.language, "INVALID_KEY");
    if (!TYPE_FILE_PATTERNS[type]) return rawResult(rawKey, this.language, "UNSUPPORTED_TYPE");
    const state = this._discoverSources();
    const cacheKey = `${state.signature}:${type}:${rawKey}`;
    if (this.cache.has(cacheKey)) return { ...this.cache.get(cacheKey) };
    const search = this._findMatches(type, rawKey, state);
    let result;
    if (!state.complete || search.limitReached) result = rawResult(rawKey, this.language, "INCOMPLETE_SOURCE_SCAN", { sources: search.matches, scannedFiles: search.scanned, missingDescriptors: state.missingDescriptors });
    else if (search.matches.length === 0) result = rawResult(rawKey, this.language, "NOT_FOUND", { scannedFiles: search.scanned });
    else if (!search.matches.every((match) => isStaticValue(match.value))) result = rawResult(rawKey, this.language, "UNRESOLVED_DYNAMIC_VALUE", { sources: search.matches, scannedFiles: search.scanned });
    else {
      const values = [...new Set(search.matches.map((match) => match.value))];
      if (values.length !== 1) result = rawResult(rawKey, this.language, "CONFLICT", { sources: search.matches, scannedFiles: search.scanned });
      else {
        const source = search.matches.length === 1 ? search.matches[0] : null;
        result = {
          localizedValue: values[0],
          rawKey,
          language: this.language,
          sourceFile: source?.sourceFile || null,
          sourceMod: source?.sourceMod || null,
          confidence: search.matches.length === 1 ? "CONFIRMED" : "CONFIRMED_IDENTICAL_SOURCES",
          sources: search.matches,
          scannedFiles: search.scanned
        };
      }
    }
    this.cache.set(cacheKey, result);
    return { ...result };
  }

  resolveForDisplay(type, value) {
    const rawKey = normalizeKey(value);
    if (!rawKey) return rawResult(value ?? null, this.language, "INVALID_KEY");
    if (!TYPE_FILE_PATTERNS[type]) return rawResult(rawKey, this.language, "UNSUPPORTED_TYPE");
    if (/[^\x00-\x7F]/.test(rawKey) || /\s/.test(rawKey)) return rawResult(rawKey, this.language, "DISPLAY_LITERAL");
    const state = this._discoverSources();
    const fullCacheKey = `${state.signature}:${type}:${rawKey}`;
    if (this.cache.has(fullCacheKey)) return { ...this.cache.get(fullCacheKey) };
    const cacheKey = `${state.signature}:display:${type}:${rawKey}`;
    if (this.cache.has(cacheKey)) return { ...this.cache.get(cacheKey) };
    const search = this._findMatches(type, rawKey, state, { includeFallback: false, maxFiles: MAX_DISPLAY_FILES_PER_LOOKUP });
    let result;
    if (!state.complete || search.limitReached) result = rawResult(rawKey, this.language, "INCOMPLETE_SOURCE_SCAN", { sources: search.matches, scannedFiles: search.scanned, missingDescriptors: state.missingDescriptors });
    else if (search.matches.length === 0) result = rawResult(rawKey, this.language, "NOT_FOUND_TYPED_ONLY", { scannedFiles: search.scanned });
    else if (!search.matches.every((match) => isStaticValue(match.value))) result = rawResult(rawKey, this.language, "UNRESOLVED_DYNAMIC_VALUE", { sources: search.matches, scannedFiles: search.scanned });
    else {
      const values = [...new Set(search.matches.map((match) => match.value))];
      if (values.length !== 1) result = rawResult(rawKey, this.language, "CONFLICT", { sources: search.matches, scannedFiles: search.scanned });
      else {
        const source = search.matches.length === 1 ? search.matches[0] : null;
        result = {
          localizedValue: values[0],
          rawKey,
          language: this.language,
          sourceFile: source?.sourceFile || null,
          sourceMod: source?.sourceMod || null,
          confidence: search.matches.length === 1 ? "CONFIRMED" : "CONFIRMED_IDENTICAL_SOURCES",
          sources: search.matches,
          scannedFiles: search.scanned
        };
      }
    }
    this.cache.set(cacheKey, result);
    return { ...result };
  }

  findRawKeysByLocalizedValue(type, value, { typedOnly = false, matchMode = "exact" } = {}) {
    const localizedValue = normalizeKey(value);
    if (!localizedValue || !TYPE_FILE_PATTERNS[type]) return { status: "INVALID_QUERY", matches: [], sourceComplete: false, scannedFiles: 0, missingDescriptors: [], matchedRawKeys: [] };
    const state = this._discoverSources();
    const safeMatchMode = matchMode === "prefix" ? "prefix" : "exact";
    const cacheKey = `${state.signature}:reverse:${type}:${localizedValue}:${typedOnly ? "typed" : "full"}:${safeMatchMode}`;
    if (this.cache.has(cacheKey)) return { ...this.cache.get(cacheKey), matches: this.cache.get(cacheKey).matches.map((item) => ({ ...item })), matchedRawKeys: [...this.cache.get(cacheKey).matchedRawKeys] };
    const search = this._findRawKeys(type, localizedValue, state, typedOnly, safeMatchMode);
    const rawKeys = search.rawKeys;
    const scannedFiles = search.scannedFiles;
    const limitReached = search.limitReached;
    const sourceComplete = state.complete && !limitReached;
    const base = { sourceComplete, scannedFiles, missingDescriptors: [...state.missingDescriptors], matchedRawKeys: rawKeys };
    let result;
    if (!sourceComplete) result = { status: "INCOMPLETE_SOURCE_SCAN", matches: [], ...base };
    else if (safeMatchMode === "exact" && rawKeys.length > 1) result = { status: "CONFLICT", matches: [], ...base };
    else if (!rawKeys.length) result = { status: typedOnly ? "NO_MATCH_TYPED" : "NO_MATCH", matches: [], fallbackRequired: typedOnly, ...base };
    else {
      const matches = rawKeys.map((rawKey) => this.resolve(type, rawKey)).filter((item) => (safeMatchMode === "prefix" ? item.localizedValue.startsWith(localizedValue) : item.localizedValue === localizedValue) && (item.confidence === "CONFIRMED" || item.confidence === "CONFIRMED_IDENTICAL_SOURCES"));
      if (safeMatchMode === "prefix") result = matches.length ? { status: "PREFIX_MATCHES", matches, ...base } : { status: "NO_MATCH", matches: [], ...base };
      else result = matches.length === 1 ? { status: "MATCHED", matches, ...base } : { status: "CONFLICT", matches: [], ...base };
    }
    this.cache.set(cacheKey, result);
    return { ...result, matches: result.matches.map((item) => ({ ...item })), matchedRawKeys: [...result.matchedRawKeys] };
  }
}

module.exports = { CK3LocalizationResolver };
