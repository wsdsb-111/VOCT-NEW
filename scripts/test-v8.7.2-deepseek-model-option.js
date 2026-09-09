"use strict";

const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { DeepseekProvider } = require(path.join(root, "resources", "app", "out", "main", "providers"));

(async () => {
  const models = await new DeepseekProvider().listModels({});
  assert.deepStrictEqual(models.slice(0, 2), [
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" }
  ], "existing DeepSeek model options must remain unchanged");
  assert.deepStrictEqual(models[2], {
    id: "deepseek-v4.1-flash-expires-on-0910",
    name: "deepseek-v4.1-flash-expires-on-0910"
  }, "the expiring DeepSeek model must be selectable by its exact API model name");
  console.log("VOTC v8.7.2 DeepSeek model option: PASS (exact model name added without changing existing options)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
