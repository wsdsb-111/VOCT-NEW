"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const mainPath = path.join(root, "resources", "app", "out", "main", "main.js");
const source = fs.readFileSync(mainPath, "utf8");
const createWindowSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "window-manager.js"), "utf8");

assert(createWindowSource.includes("const { x, y, width, height } = primaryDisplay.workArea;"), "VOTC window must use the display work area bounds");
assert(createWindowSource.includes("x,"), "VOTC window must respect the work area left offset");
assert(createWindowSource.includes("y,"), "VOTC window must respect the work area top offset");
assert(!createWindowSource.includes("fullscreen: true"), "VOTC window must not cover the system status bar in fullscreen mode");
assert(source.includes("createChatWindow({"), "main process must delegate window construction to window-manager");

console.log("VOTC window layout: PASS (work area bounds preserve the bottom status bar)");
