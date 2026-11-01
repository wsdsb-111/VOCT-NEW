"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chapterBody, classify, normalize, sha, marker, rewriteLinks } = require("./consolidate-version-docs");
const root = path.resolve(__dirname, "..");
const manifest = require("../docs/versions/manifest.json");
assert.equal(manifest.schemaVersion, 1);
assert(/^[a-f0-9]{40}$/.test(manifest.sourceCommit));
assert.equal(classify("docs/real-request-diff-implementation-report.md"), "v8/V8.9");
assert.equal(classify("docs/AE4_Spec_Errata-001_Self-Target目标约束冲突修正.md"), "v7/V7.9");
assert.equal(classify("docs/EXTERNAL_RUNTIME_DEPENDENCIES.md"), null);
assert.equal(classify("docs/current/v9/V9_1_2_IMPLEMENTATION.md"), "v9/V9.1");
const sourceTree = execFileSync("git", ["-c", "core.quotepath=false", "ls-tree", "-r", "--name-only", manifest.sourceCommit, "--", "docs"],
  { cwd: root, encoding: "utf8" }).trim().split("\n");
const explicitlyAssigned = new Set(["docs/real-request-diff-implementation-report.md",
  "docs/AE4_Spec_Errata-001_Self-Target目标约束冲突修正.md"]);
const expectedSources = sourceTree.filter(file => file.endsWith(".md") && !file.endsWith("/AGENTS.md")
  && (/(?:^|[^a-z])v[6-9](?:[._]\d+|阶段|_)/i.test(path.posix.basename(file)) || explicitlyAssigned.has(file)));
assert.deepEqual(manifest.entries.map(entry => entry.source).sort(), expectedSources.sort(), "no complete historical source document omitted");

function markdownLinks(text) {
  return [...text.matchAll(/!?\[[^\]\n]*\]\((<[^>]+>|[^)\s]+)\)/g)].map(match => match[1].replace(/^<|>$/g, ""));
}
function resolveLink(url, from) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(url)) return { external: url };
  const split = url.indexOf("#");
  const file = split < 0 ? url : url.slice(0, split);
  return { file: file ? path.posix.normalize(path.posix.join(path.posix.dirname(from), decodeURIComponent(file))) : from,
    fragment: split < 0 ? "" : decodeURIComponent(url.slice(split + 1)) };
}

const input = manifest.entries.map(entry => `${manifest.sourceCommit}:${entry.source}\n`).join("");
const objects = execFileSync("git", ["cat-file", "--batch"], { cwd: root, input, maxBuffer: 64 * 1024 * 1024 });
const books = new Map(manifest.books.map(book => [book, normalize(fs.readFileSync(path.join(root, book), "utf8"))]));
let offset = 0;
for (const entry of manifest.entries) {
  const end = objects.indexOf(10, offset);
  const header = objects.subarray(offset, end).toString("utf8");
  const size = Number(header.match(/ blob (\d+)$/)?.[1]);
  assert(Number.isSafeInteger(size), `missing original Git blob: ${entry.source}`);
  offset = end + 1;
  const original = normalize(objects.subarray(offset, offset + size).toString("utf8"));
  offset += size + 1;
  assert.equal(sha(original), entry.sourceSha256, `original source changed: ${entry.source}`);
  const expected = chapterBody(original, entry, manifest.entries);
  assert.equal(sha(expected), entry.bodySha256);
  const book = books.get(entry.target);
  const startMark = `<!-- chapter:${entry.anchor}:start -->`;
  const endMark = `<!-- chapter:${entry.anchor}:end -->`;
  assert.equal(book.split(startMark).length, 2, `chapter appears exactly once: ${entry.source}`);
  const segment = book.split(startMark)[1].split(endMark)[0];
  assert(segment.endsWith(`\n\n${expected}\n`), `full source text preserved (only links/anchors transformed): ${entry.source}`);
  const oldLinks = markdownLinks(original), newLinks = markdownLinks(expected);
  assert.equal(oldLinks.length, newLinks.length, "no inline link disappeared");
  for (let index = 0; index < oldLinks.length; index++) {
    const old = resolveLink(oldLinks[index], entry.source), current = resolveLink(newLinks[index], entry.target);
    if (old.external) { assert.deepEqual(current, old); continue; }
    const destination = manifest.entries.find(item => item.source === old.file);
    const canMap = destination && (!old.fragment || destination.headings.some(heading => heading.slug === old.fragment));
    if (canMap) {
      assert.deepEqual(current, { file: destination.target,
        fragment: old.fragment ? `${destination.anchor}--${old.fragment}` : destination.anchor });
    } else assert.deepEqual(current, old, "unrecognized anchors and non-consolidated paths retain their precise target");
    if (fs.existsSync(path.join(root, old.file))) assert(fs.existsSync(path.join(root, current.file)), "no new missing relative file target");
  }
  const stub = fs.readFileSync(path.join(root, entry.source), "utf8");
  assert(stub.includes(marker), "old URL remains a compatibility index");
  for (const heading of entry.headings) {
    assert(stub.includes(`<a id="${heading.slug}"></a>`), `old heading URL preserved: ${entry.source}#${heading.slug}`);
    assert(book.includes(`<a id="${entry.anchor}--${heading.slug}"></a>`));
  }
}
assert.equal(offset, objects.length);
for (const entry of manifest.entries.filter(item => item.target.endsWith("/OVERVIEW.md"))) {
  for (const heading of entry.headings) {
    for (const version of heading.title.matchAll(/v([6-9])\.(\d+)/ig)) {
      const book = `docs/versions/v${version[1]}/V${version[1]}.${Number(version[2])}.md`;
      const text = fs.readFileSync(path.join(root, book), "utf8");
      assert(text.includes(`#${entry.anchor}--${heading.slug}`), "each explicitly versioned continuous-record heading has a minor-version entry");
    }
  }
}

const sample = manifest.entries.find(entry => entry.headings.length);
const link = `[jump](${path.posix.basename(sample.source)}#${sample.headings[0].slug})`;
assert(rewriteLinks(link, sample.source, sample.target, manifest.entries).includes(`#${sample.anchor}--${sample.headings[0].slug}`));
assert(rewriteLinks(`[unknown](#synthetic-unknown-fragment)`, sample.source, sample.target, manifest.entries)
  .endsWith("#synthetic-unknown-fragment)"), "unknown old fragment must not be replaced with chapter start");
let linkCount = 0;
for (const [file, text] of books) {
  for (const match of text.matchAll(/!?\[[^\]\n]*\]\((<[^>]+>|[^)\s]+)\)/g)) {
    const raw = match[1].replace(/^<|>$/g, "");
    if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(raw)) continue;
    const [relative, fragment] = raw.split("#");
    let decoded;
    try { decoded = decodeURIComponent(relative); } catch { continue; }
    const target = decoded ? path.posix.normalize(path.posix.join(path.posix.dirname(file), decoded)) : file;
    if (!books.has(target)) continue;
    if (fragment?.startsWith("source-")) {
      assert(books.get(target).includes(`<a id="${decodeURIComponent(fragment)}"></a>`), `canonical link anchor missing: ${file} -> ${raw}`);
      linkCount++;
    }
  }
}
console.log(`PASS version documents: ${manifest.entries.length} complete source documents -> ${manifest.books.length} books; Git source hashes, all chapters/old anchors and ${linkCount} canonical links verified`);
