/** Build the V9.5 review manifest for the DeepSeek visual delivery. */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const REVIEW = resolve(HERE, "..");
const OUT = resolve(REVIEW, "MANIFEST.json");

const areas = [
  ["src/app/renderer/v95/icons", "production"],
  ["src/app/renderer/v95/visual", "production"],
  ["review/v95-deepseek", "review"]
];
const includeReview = new Set([
  "COORDINATION.md", "HANDOFF.md", "COMPONENTS.md", "UI_DESIGN_DECISIONS.md",
  "LOCALE_KEY_REQUESTS.md", "INTEGRATION_REQUESTS.md",
  "showcase.html", "showcase.css", "showcase.js", "serve.mjs"
]);

const files = [];
function addFile(path, area) {
  const absolute = resolve(path);
  const stat = statSync(absolute);
  if (!stat.isFile()) return;
  const rel = relative(ROOT, absolute).replace(/\\/g, "/");
  if (rel === "review/v95-deepseek/MANIFEST.json") return;
  if (rel.includes("_chrome-profile")) return;
  const bytes = readFileSync(absolute);
  files.push({
    path: rel,
    area,
    bytes: stat.size,
    sha256: createHash("sha256").update(bytes).digest("hex")
  });
}

for (const [relativeDir, area] of areas) {
  const base = resolve(ROOT, relativeDir);
  const walk = directory => {
    for (const entry of readdirSync(directory)) {
      if (entry.startsWith(".")) continue;
      const path = join(directory, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        if (entry === "_chrome-profile" || entry === "node_modules") continue;
        walk(path);
      } else if (stat.isFile()) {
        if (area === "review") {
          const relToReview = relative(REVIEW, path).replace(/\\/g, "/");
          const [top, second] = relToReview.split("/");
          if (top === "screenshots" || top === "fixtures") {
            // All screenshots and fixtures are part of the review evidence.
          } else if (second === undefined && includeReview.has(top)) {
            // Root review docs / showcase files.
          } else if (top === "tests" && !top.startsWith(".")) {
            // test scripts and last-run evidence
          } else {
            continue;
          }
        }
        addFile(path, area);
      }
    }
  };
  walk(base);
}

files.sort((a, b) => a.path.localeCompare(b.path));

const manifest = {
  name: "V9.5 DeepSeek Harness visual layer",
  status: "review-candidate",
  generatedAt: new Date().toISOString(),
  generatedBy: "DeepSeek Harness",
  baseline: "713e9f614ab233fc3e9d0041cbb93018a54f6886",
  contract: { name: "v95-view-v1", revision: 1, frozenDoc: "docs/current/v9/V9_5_VIEW_CONTRACT_FREEZE.md" },
  scope: [
    "src/app/renderer/v95/visual/**",
    "src/app/renderer/v95/icons/**",
    "review/v95-deepseek/**"
  ],
  notModified: [
    "src/app/main/**", "src/app/preload/**", "src/app/renderer/index.html",
    "src/app/renderer/assets/**", "src/app/renderer/ui-comfort.css",
    "src/app/renderer/v95/contracts/**", "src/app/renderer/v95/i18n/**",
    "src/app/renderer/v95/state/**", "src/app/renderer/v95/adapters/**",
    "src/app/renderer/v95/containers/**", "build/**", "resources/app/out/**",
    "scripts/**", "docs/**", ".github/**"
  ],
  source: "original UI work; read-only use of frozen contracts/i18n",
  license: "project-internal, original; no third-party icon or font assets",
  dependencies: {
    runtime: [],
    readOnly: [
      "src/app/renderer/v95/contracts/view-contract.v1.js",
      "src/app/renderer/v95/contracts/async-states.v1.js",
      "src/app/renderer/v95/i18n/index.js",
      "src/app/renderer/v95/i18n/locales/zh-CN.js",
      "src/app/renderer/v95/i18n/locales/en-US.js"
    ],
    host: "Chromium/Electron with color-mix, container queries, :has()"
  },
  verification: {
    command: "node review/v95-deepseek/tests/run-ui-tests.mjs",
    result: "22/22 checks passed",
    evidence: "review/v95-deepseek/tests/last-run.txt",
    screenshots: "review/v95-deepseek/screenshots/",
    notRun: [
      "real Electron integration / packaged EXE",
      "real Windows 125%/150% DPI",
      "production i18next instance",
      "real CK3 / Provider / Soak",
      "screen reader and full keyboard journey",
      "performance P50/P95 and 50k-row rendering"
    ]
  },
  files
};

writeFileSync(OUT, JSON.stringify(manifest, null, 2));
console.log(`wrote ${relative(ROOT, OUT)} with ${files.length} files`);
