"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { filesUnder } = require("./v9.7-reference-audit");
const root = path.resolve(__dirname, "..");
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const normalize = text => text.replace(/\r\n/g, "\n");
const marker = "<!-- version-document-redirect:v1 -->";

function classify(file) {
  const special = {
    "docs/real-request-diff-implementation-report.md": "v8/V8.9",
    "docs/AE4_Spec_Errata-001_Self-Target目标约束冲突修正.md": "v7/V7.9",
    "docs/current/v9/V9_STARTUP_PERFORMANCE_INVESTIGATION.md": "v9/V9.0"
  };
  if (special[file]) return special[file];
  const name = path.posix.basename(file);
  if (/^V[678]阶段/.test(name)) return `v${name[1]}/OVERVIEW`;
  const match = name.match(/(?:^|[^a-z])v([6-9])(?:[._](\d+))?/i);
  if (!match) return null;
  return `v${match[1]}/${match[2] == null ? "CONTRACTS" : `V${match[1]}.${Number(match[2])}`}`;
}

function headings(text) {
  const used = new Map();
  let fence = null;
  const result = [];
  for (const line of normalize(text).split("\n")) {
    const boundary = line.match(/^\s*(`{3,}|~{3,})/);
    if (boundary) {
      if (!fence) fence = boundary[1][0];
      else if (boundary[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!heading) continue;
    const title = heading[1];
    const base = title.toLowerCase().replace(/<[^>]*>/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "").replace(/\s/g, "-");
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    result.push({ title, slug: base + (count ? `-${count}` : "") });
  }
  return result;
}

function rewriteLinks(text, from, to, entries) {
  const resolve = url => {
    const angle = url.startsWith("<") && url.endsWith(">");
    const raw = angle ? url.slice(1, -1) : url;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(raw)) return url;
    const hashAt = raw.indexOf("#");
    const filePart = hashAt < 0 ? raw : raw.slice(0, hashAt);
    const fragment = hashAt < 0 ? "" : raw.slice(hashAt + 1);
    let decoded;
    try { decoded = decodeURIComponent(filePart); } catch { return url; }
    const oldTarget = decoded ? path.posix.normalize(path.posix.join(path.posix.dirname(from), decoded)) : from;
    const entry = entries.find(item => item.source === oldTarget);
    const target = entry?.target || oldTarget;
    const relative = path.posix.relative(path.posix.dirname(to), target) || path.posix.basename(target);
    let anchor = fragment;
    if (entry) {
      let slug;
      try { slug = decodeURIComponent(fragment); } catch { slug = fragment; }
      if (fragment && !entry.headings.some(item => item.slug === slug)) {
        // An unrecognized historical fragment must not silently become a chapter jump.
        const oldRelative = path.posix.relative(path.posix.dirname(to), oldTarget);
        const preserved = oldRelative + "#" + fragment;
        return angle || /\s/.test(preserved) ? `<${preserved}>` : preserved;
      }
      anchor = fragment ? `${entry.anchor}--${slug}` : entry.anchor;
    }
    const result = relative + (anchor ? `#${anchor}` : "");
    return angle || /\s/.test(result) ? `<${result}>` : result;
  };
  let fence = null;
  return normalize(text).split("\n").map(line => {
    const boundary = line.match(/^\s*(`{3,}|~{3,})/);
    if (boundary) { if (!fence) fence = boundary[1][0]; else if (boundary[1][0] === fence) fence = null; return line; }
    if (fence) return line;
    return line.replace(/(!?\[[^\]\n]*\]\()(<[^>]+>|[^)\s]+)(\))/g, (_all, start, url, end) => start + resolve(url) + end)
      .replace(/^(\s*\[[^\]]+\]:\s*)(<[^>]+>|\S+)/, (_all, start, url) => start + resolve(url));
  }).join("\n");
}

function chapterBody(text, entry, entries) {
  let index = 0, fence = null;
  return rewriteLinks(text, entry.source, entry.target, entries).split("\n").map(line => {
    const boundary = line.match(/^\s*(`{3,}|~{3,})/);
    if (boundary) { if (!fence) fence = boundary[1][0]; else if (boundary[1][0] === fence) fence = null; return line; }
    if (!fence && /^#{1,6}\s+/.test(line)) {
      const heading = entry.headings[index++];
      return `<a id="${entry.anchor}--${heading.slug}"></a>\n${line}`;
    }
    return line;
  }).join("\n");
}

function indexContinuousRecords(entries, books) {
  const linksByVersion = new Map();
  for (const entry of entries.filter(item => item.target.endsWith("/OVERVIEW.md"))) {
    for (const heading of entry.headings) {
      for (const match of heading.title.matchAll(/v([6-9])\.(\d+)/ig)) {
        const book = `docs/versions/v${match[1]}/V${match[1]}.${Number(match[2])}.md`;
        const url = path.posix.relative(path.posix.dirname(book), entry.target) + `#${entry.anchor}--${heading.slug}`;
        const links = linksByVersion.get(book) || new Set();
        links.add(`- [${heading.title}](${url})`);
        linksByVersion.set(book, links);
      }
    }
  }
  const indexes = [];
  for (const [book, links] of linksByVersion) {
    const block = `<!-- continuous-record-index:start -->\n## 连续阶段记录直达\n\n原文整体保留在本阶段 OVERVIEW，以下只提供本小版本的准确章节入口，不复制或改写历史结果。\n\n${[...links].join("\n")}\n<!-- continuous-record-index:end -->\n\n`;
    if (books.includes(book)) {
      const text = fs.readFileSync(path.join(root, book), "utf8");
      const firstChapter = text.indexOf("<!-- chapter:");
      fs.writeFileSync(path.join(root, book), text.slice(0, firstChapter) + block + text.slice(firstChapter));
    } else {
      fs.writeFileSync(path.join(root, book), `# ${path.posix.basename(book, ".md")} 阶段记录索引\n\n${block}`);
      indexes.push(book);
    }
  }
  for (const major of [6, 7, 8, 9]) {
    const selected = [...books, ...indexes].filter(book => book.startsWith(`docs/versions/v${major}/`))
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    fs.writeFileSync(path.join(root, `docs/versions/v${major}/README.md`), `# V${major} 阶段文档\n\n补丁版本合并到同一小版本册；OVERVIEW 为跨小版本连续记录，CONTRACTS 为跨版本合同/路线。仅有连续记录的版本提供直达索引。\n\n`
      + selected.map(book => `- [${path.posix.basename(book, ".md")}](${path.posix.basename(book)})`).join("\n") + "\n");
  }
  return indexes.sort();
}

function plan() {
  const entries = filesUnder(path.join(root, "docs")).filter(file => file.endsWith(".md"))
    .map(file => path.relative(root, file).replaceAll("\\", "/"))
    .filter(file => !file.startsWith("docs/versions/") && !file.endsWith("/AGENTS.md"))
    .flatMap(source => {
      const group = classify(source);
      if (!group) return [];
      const bytes = fs.readFileSync(path.join(root, source));
      const text = bytes.toString("utf8");
      if (text.includes(marker)) throw new Error("version_docs_already_consolidated");
      return [{ source, target: `docs/versions/${group}.md`, anchor: `source-${sha(source).slice(0, 12)}`,
        sourceSha256: sha(normalize(text)), headings: headings(text), text }];
    });
  return entries.sort((a, b) => a.source.localeCompare(b.source, "en", { numeric: true }));
}

function apply() {
  const entries = plan();
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const backup = path.join(root, ".build/version-docs-before");
  fs.mkdirSync(backup, { recursive: true });
  // Save and verify every original before replacing any old body with an index.
  for (const entry of entries) {
    const destination = path.join(backup, entry.source);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, entry.source), destination);
    if (sha(normalize(fs.readFileSync(destination, "utf8"))) !== entry.sourceSha256) throw new Error("version_docs_backup_mismatch");
  }
  const books = [...new Set(entries.map(entry => entry.target))].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  for (const book of books) {
    const chapters = entries.filter(entry => entry.target === book);
    let text = `# ${path.posix.basename(book, ".md")} 版本册\n\n原文按来源合并，保留设计、实施、修复、失败与待验结论；历史文字中的“当前”只属于其原版本。`;
    text += `源码快照：\`${sourceCommit}\`。旧页仅保留链接兼容索引。\n\n`;
    text += chapters.map(entry => `- [${path.posix.basename(entry.source)}](#${entry.anchor})`).join("\n") + "\n\n";
    for (const entry of chapters) {
      const body = chapterBody(entry.text, entry, entries);
      entry.bodySha256 = sha(body);
      text += `<!-- chapter:${entry.anchor}:start -->\n<a id="${entry.anchor}"></a>\n## 来源：${entry.source}\n\n原文规范化 SHA-256：\`${entry.sourceSha256}\`。\n\n${body}\n<!-- chapter:${entry.anchor}:end -->\n\n`;
    }
    const destination = path.join(root, book);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, text);
  }
  for (const entry of entries) {
    const relative = path.posix.relative(path.posix.dirname(entry.source), entry.target);
    let stub = `${marker}\n# 历史链接索引\n\n本文原文已完整合并到 [${path.posix.basename(entry.target, ".md")} 版本册](${relative}#${entry.anchor})。\n此页仅兼容旧链接；请从版本目录阅读，历史结论未重新验收。\n\n`;
    for (const heading of entry.headings) stub += `<a id="${heading.slug}"></a>\n- [${heading.title}](${relative}#${entry.anchor}--${heading.slug})\n`;
    fs.writeFileSync(path.join(root, entry.source), stub);
  }
  // Keep old external URLs via stubs, while current internal navigation goes directly to books.
  for (const relative of ["README.md", "CHANGELOG.md", ...filesUnder(path.join(root, "docs"))
    .map(file => path.relative(root, file).replaceAll("\\", "/")).filter(file => file.endsWith(".md"))]) {
    if (entries.some(entry => entry.source === relative) || relative.startsWith("docs/versions/")) continue;
    const file = path.join(root, relative), before = fs.readFileSync(file, "utf8");
    const after = rewriteLinks(before, relative, relative, entries);
    if (after !== normalize(before)) fs.writeFileSync(file, after);
  }
  const continuousIndexes = indexContinuousRecords(entries, books);
  const manifest = { schemaVersion: 1, sourceCommit, entries: entries.map(({ text, ...entry }) => entry), books, continuousIndexes };
  fs.writeFileSync(path.join(root, "docs/versions/manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return { sourceDocuments: entries.length, versionBooks: books.length, sourceCommit };
}

if (require.main === module) {
  if (process.argv.includes("--apply")) console.log(JSON.stringify(apply(), null, 2));
  else {
    const entries = plan();
    console.log(JSON.stringify({ sourceDocuments: entries.length, books: [...new Set(entries.map(entry => entry.target))],
      unclassified: filesUnder(path.join(root, "docs")).filter(file => file.endsWith(".md"))
        .map(file => path.relative(root, file).replaceAll("\\", "/")).filter(file => !classify(file)) }, null, 2));
  }
}
module.exports = { classify, headings, rewriteLinks, chapterBody, normalize, sha, marker, indexContinuousRecords };
