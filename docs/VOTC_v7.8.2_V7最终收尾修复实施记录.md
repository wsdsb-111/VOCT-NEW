# VOTC v7.8.2 V7 最终收尾修复实施记录

## 版本范围

v7.8.2 只处理最终问题清单中属于 V7 热修的代码、回归测试和版本文档。Memory Engine 保持 2.4，外挂 UI 与 CK3 模组版本保持 2.0.4；不引入 V8 架构改造，不改变摘要文件、设置键、IPC 或 Provider 数据合同。

## 已实施修复

- `resources/app/out/main/prompts/template-engine.js`：默认 helper 目录从重复的 `prompts/prompts/helpers` 修正为真实打包路径 `default_userdata/prompts/helpers`。
- `scripts/test-v7.8.1-prompt-dependencies.js`：测试夹具改为显式建立并传入 `default_userdata/prompts`，防止错误目录结构把生产缺陷伪装成通过。
- `resources/app/out/main/game-data/character.js`：`removeTrait()` 将 `filter()` 结果重新赋值给 `this.traits`，保留原有大小写不敏感匹配语义。

## 发布回归补强

- `scripts/test-v7.8.2-final-v7-hotfix.js` 直接加载真实路径配置、TemplateEngine、打包默认 helpers 和 Character，验证 helper 目录合同及特质删除。
- `scripts/test-v7.8.2-full-prompt-smoke.js` 使用真实 `default.hbs`、`letter.hbs`、helpers、PromptScriptSandbox、PromptBuilder 和 LetterPromptBuilder，覆盖完整对话与信件 Prompt 组装、稳定缓存块顺序及模板实际输出。
- `scripts/test-v7.7.2-staged-presence.js` 增加唯一 NPC 暂离/返回回归，并验证多次缺席的终局配对摘要不会泄漏任何窗口间隙内容。
- 统一发布清单增至 41 组，覆盖 74 个 `test-*.js` 文件；36 条轻量语义金标样例保持不变。

## V8 延后事项

- `gameData.dynasty` 的数据源和更新时机需要在 V8 动态历史边界中统一，避免在 V7 热修中并行维护第二套朝代状态。
- `updateCurrentEmperorInfo` 的解析、状态更新与 Prompt 消费职责需要在 V8 继续收束；本版本只记录，不重构该链路。

## 验收边界

本地 `node scripts/test-release.js` 已通过 41/41 个发布组并覆盖 74 个测试文件；打包 `VOTC.exe` 隐藏启动冒烟中 4 个 Electron/VOTC 进程均可响应，结束后无残留进程。真实 Provider 请求、真实 CK3 日志联动、GitHub Actions、提交与标签仍属于发布前人工冻结门禁；本次实现没有消耗用户 API 配额、修改实际游戏状态或代替用户创建提交和标签。
