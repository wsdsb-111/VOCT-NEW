"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const rendererPath = path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js");
const stylePath = path.join(root, "resources", "app", "out", "renderer", "assets", "index-WtJH_nua.css");
const renderer = fs.readFileSync(rendererPath, "utf8");
const styles = fs.readFileSync(stylePath, "utf8");
const finalThemeBlock = styles.slice(styles.lastIndexOf("/* V8.8 visual theme backgrounds"));

const themes = [
  { key: "parchment", label: "游牧", image: "草原游牧.png" },
  { key: "knight", label: "骑士", image: "中世纪骑士.png" },
  { key: "ink", label: "水墨", image: "中国古典.png" }
];

for (const theme of themes) {
  const cssImage = `../../../../../image/${theme.image}`;
  const buttonImage = `./assets/theme-${theme.key === "parchment" ? "parchment" : theme.key === "knight" ? "knight" : "ink"}-v1.png`;
  const cssImagePath = path.resolve(path.dirname(stylePath), cssImage);

  assert.ok(fs.existsSync(cssImagePath), `${theme.label} background image is missing`);
  assert.match(finalThemeBlock, new RegExp(`data-votc-theme="${theme.key}"`));
  assert.ok(finalThemeBlock.includes(`--votc-style-image: url("${cssImage}")`), `${theme.label} CSS image mapping is missing`);
  assert.ok(renderer.includes(`src: "${buttonImage}"`), `${theme.label} theme control icon must remain unchanged`);
}

const transparencyContracts = [
  ["游牧", "linear-gradient(rgba(250, 247, 239, 0.45), rgba(241, 235, 220, 0.56))", "rgba(250, 246, 235, 0.8)"],
  ["骑士", "linear-gradient(rgba(18, 19, 23, 0.58), rgba(12, 13, 17, 0.68))", "rgba(22, 23, 28, 0.82)"],
  ["水墨", "linear-gradient(rgba(250, 248, 239, 0.3), rgba(239, 237, 225, 0.43))", "rgba(250, 247, 238, 0.78)"]
];

for (const [label, contentOverlay, surface] of transparencyContracts) {
  assert.ok(finalThemeBlock.includes(`--votc-content-overlay: ${contentOverlay}`), `${label} content overlay must leave the background visible`);
  assert.ok(finalThemeBlock.includes(`--votc-surface: ${surface}`), `${label} cards must remain translucent`);
}

assert.match(finalThemeBlock, /:root\[data-votc-theme="parchment"\] \.worldline-view/);
assert.match(finalThemeBlock, /background-color: rgba\(190, 202, 196, 0\.72\)/);
assert.match(finalThemeBlock, /background-color: rgba\(232, 233, 221, 0\.78\)/);
assert.match(finalThemeBlock, /:root\[data-votc-theme="ink"\] \.worldline-view/);
assert.match(finalThemeBlock, /background-color: rgba\(181, 166, 141, 0\.58\)/);
assert.match(finalThemeBlock, /background-color: rgba\(247, 237, 215, 0\.8\)/);
assert.match(finalThemeBlock, /color: #26322f/);
assert.match(finalThemeBlock, /color: #302b26/);

assert.match(styles, /--votc-style-overlay:/);
assert.match(styles, /--votc-content-overlay:/);
assert.match(finalThemeBlock, /background-image: var\(--votc-style-overlay\), var\(--votc-style-image\)/);
assert.match(finalThemeBlock, /background-image: var\(--votc-content-overlay\), var\(--votc-style-image\)/);
assert.match(finalThemeBlock, /--votc-control-bg:/);
assert.match(finalThemeBlock, /--votc-control-text:/);
assert.match(finalThemeBlock, /url\("\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/image\/草原游牧\.png"\)/);
assert.match(finalThemeBlock, /url\("\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/image\/中世纪骑士\.png"\)/);
assert.match(finalThemeBlock, /url\("\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/image\/中国古典\.png"\)/);
assert.match(styles, /content: "游牧"/);
assert.match(renderer, /title: "游牧风格"/);

console.log("V8.8 UI style backgrounds and readability: PASS");
