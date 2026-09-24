"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const normalizeLf = value => String(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
const rendererPath = path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js");
const stylePath = path.join(root, "resources", "app", "out", "renderer", "assets", "index-WtJH_nua.css");
const renderer = normalizeLf(fs.readFileSync(rendererPath, "utf8"));
const styles = normalizeLf(fs.readFileSync(stylePath, "utf8"));
const preview = normalizeLf(fs.readFileSync(path.join(root, "ui-theme-preview.html"), "utf8"));
assert.equal(normalizeLf("color: #263b37;\r\n  text-shadow: none;"), "color: #263b37;\n  text-shadow: none;", "CRLF checkouts must use the same assertion text");
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
  assert.ok(renderer.includes(`src: "${buttonImage}"`), `${theme.label} theme control icon must keep its stable renderer reference`);
}

const nomadIconPath = path.join(root, "resources", "app", "out", "renderer", "assets", "theme-parchment-v1.png");
const nomadIcon = fs.readFileSync(nomadIconPath);
assert.deepStrictEqual(Array.from(nomadIcon.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10], "游牧主题图标必须是有效 PNG");
assert.strictEqual(nomadIcon.readUInt32BE(16), 1254, "游牧主题图标宽度必须保持 1254px");
assert.strictEqual(nomadIcon.readUInt32BE(20), 1254, "游牧主题图标高度必须保持 1254px");
assert.strictEqual(nomadIcon[25], 6, "游牧主题图标必须使用 RGBA 透明通道，不能保留方形底色");

const transparencyContracts = [
  ["游牧", "linear-gradient(rgba(250, 247, 239, 0.45), rgba(241, 235, 220, 0.56))", "rgba(250, 246, 235, 0.8)"],
  ["骑士", "linear-gradient(rgba(18, 19, 23, 0.58), rgba(12, 13, 17, 0.68))", "rgba(22, 23, 28, 0.82)"],
  ["水墨", "linear-gradient(rgba(225, 222, 209, 0.24), rgba(207, 207, 192, 0.34))", "rgba(250, 247, 238, 0.78)"]
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
assert.ok(finalThemeBlock.includes("--votc-style-overlay: linear-gradient(rgba(43, 53, 48, 0.1), rgba(33, 43, 39, 0.18))"), "水墨 outer background must use the lowered-brightness overlay");
assert.match(finalThemeBlock, /:root\[data-votc-theme="ink"\] \.config-header \.court-theme-button img/);
assert.match(finalThemeBlock, /grayscale\(0\.72\).*hue-rotate\(92deg\).*brightness\(0\.66\)/);
assert.match(finalThemeBlock, /:root\[data-votc-theme="ink"\] \.config-header \.court-theme-button\.active img/);
assert.match(finalThemeBlock, /:root\[data-votc-theme="ink"\] \.config-header \.tooltip-button \.tooltip-icon/);
assert.match(finalThemeBlock, /color: #344b47 !important/);
assert.match(finalThemeBlock, /color: #9a6a3d !important/);
assert.ok(finalThemeBlock.includes('color: #263b37;\n  text-shadow: none;'), "水墨摘要姓名必须使用无模糊阴影的深黛墨色");
assert.ok(finalThemeBlock.includes('color: #80532f;\n  text-shadow: none;'), "水墨摘要计数必须使用清晰的沉铜色");
assert.ok(styles.includes("rgba(173, 145, 129, 0.52)"), "水墨玩家对话框必须降低纸白亮度");
assert.ok(styles.includes("rgba(151, 166, 157, 0.56)"), "水墨 NPC 对话框必须使用青灰遮罩");
assert.ok(styles.includes("background: rgba(166, 178, 168, 0.44);"), "水墨系统消息必须使用低亮度青灰底色");
assert.ok(finalThemeBlock.includes("background-color: #d8d9cc !important;"), "水墨游戏对话区必须与配置页分开降低亮度");
assert.ok(finalThemeBlock.includes("linear-gradient(rgba(195, 199, 187, 0.34), rgba(179, 188, 176, 0.44))"), "水墨游戏对话区必须使用轻微青灰遮罩");
assert.ok(finalThemeBlock.includes("repeating-linear-gradient(135deg, rgba(244, 205, 139, 0.1) 0 2px"), "游牧按钮必须使用织纹皮革表面");
assert.ok(finalThemeBlock.includes("clip-path: polygon(8px 0, calc(100% - 8px) 0, 100% 8px"), "游牧按钮必须使用皮牌切角轮廓");
assert.ok(finalThemeBlock.includes("radial-gradient(circle at 9px 50%, #b49358 0 1px"), "骑士按钮必须保留金属铆钉细节");
assert.ok(finalThemeBlock.includes("text-shadow: 0 1px 0 #000;"), "骑士按钮与摘要只允许硬边文字阴影");
assert.match(finalThemeBlock, /:root\[data-votc-theme="knight"\] \.court-theme-switcher \{[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/);
assert.match(finalThemeBlock, /:root\[data-votc-theme="knight"\] \.config-header \.court-theme-button \{[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/);
assert.ok(finalThemeBlock.includes("border-left: 3px solid #344b47;"), "水墨按钮必须使用黛青墨线结构");
assert.ok(finalThemeBlock.includes("background-image: linear-gradient(180deg, #9c4b3d, #7a352e);"), "水墨主按钮必须使用朱砂印章色");
assert.ok(finalThemeBlock.includes("color: #2f4743;\n  text-shadow: none;"), "游牧摘要姓名必须使用清晰深色文字");
assert.ok(finalThemeBlock.includes("color: #f0d69e;\n  text-shadow: 0 1px 0 #000;"), "骑士摘要姓名必须使用无模糊金属文字");
assert.ok(preview.includes('data-theme="parchment">游牧</button>'), "主题预览必须使用当前游牧名称");
assert.ok(preview.includes('data-theme="knight">骑士</button>'), "主题预览必须使用当前骑士名称");
assert.ok(preview.includes('data-theme="ink">水墨</button>'), "主题预览必须使用当前水墨名称");
assert.ok(preview.includes("<button>世界书</button>"), "主题预览必须使用世界书名称");

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
assert.match(renderer, /children: "世界书"/);
assert.ok(!renderer.includes('children: "世界线"'), "配置导航不能继续显示旧称世界线");

console.log("V8.8 UI style backgrounds, nomad icon and readability: PASS");
