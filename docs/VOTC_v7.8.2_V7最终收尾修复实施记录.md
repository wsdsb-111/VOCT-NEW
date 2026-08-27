# VOTC v7.8.2 V7 最终收尾修复实施记录

## 版本范围

v7.8.2 只处理最终问题清单中属于 V7 热修的代码、回归测试和版本文档。Memory Engine 保持 2.4，外挂 UI 与 CK3 模组版本保持 2.0.4；不引入 V8 架构改造，不改变摘要文件、设置键、IPC 或 Provider 数据合同。

## 已实施修复

- `resources/app/out/main/prompts/template-engine.js`：默认 helper 目录从重复的 `prompts/prompts/helpers` 修正为真实打包路径 `default_userdata/prompts/helpers`。
- `scripts/test-v7.8.1-prompt-dependencies.js`：测试夹具改为显式建立并传入 `default_userdata/prompts`，防止错误目录结构把生产缺陷伪装成通过。
- `resources/app/out/main/game-data/character.js`：`removeTrait()` 将 `filter()` 结果重新赋值给 `this.traits`，保留原有大小写不敏感匹配语义。

### P0 对话与信件初始化热修

`inferGenderFromPronoun` 已由 `character.js` 导出，但模块拆分后的 `game-data.js` 和 `log-parser.js` 仍以未导入的裸标识符调用。含子女、兄弟姐妹或其他带代词亲属资料的 CK3 日志会在建立 GameData/可提及人物资料时抛出 `ReferenceError`；该阶段位于对话与信件 Prompt 及 Provider 请求之前，因此界面既无回复，也不会产生 Token 用量。

热修在两个调用模块中显式导入同一 helper，不改变性别推断规则、日志格式或 Prompt。`test-v7.8-main-modularization.js` 先以缺失导入稳定复现原错误，再增加亲属资料及真实 `kids` / `siblings` 日志行作为长期回归；对话和信件完整 Prompt 冒烟继续通过。

### P0 人物摘要目录未落盘热修

2026-08-26 21:47:47 的三人对话现场显示 `final_summary` 已成功返回 2049 个输出 Token，6 条长期记忆和 4 个详细叙事分段也已解析并写入内部 Memory；但 recovery snapshot 的 `finalizationStage` 为 `persist`、`lastError` 为 `MEMORY_ENGINE_VERSION is not defined`。模块拆分后的 `game-data.js` 在构造人物目录记录时使用该版本常量，却没有从 `version.js` 导入，导致第一个有向文件写入前失败。

热修显式导入当前 Memory Engine 版本，不改变恢复快照、投影或文件格式。`test-v7.6.1-directed-summary-persistence.js` 不再只验证手工生成的文件集合，新增生产 `GameData.saveCharactersSummaries()` 三人调用，要求生成并核验 6 个有向文件且每条记录均为 Engine 2.4。现场失败数据仍保留完整 providerOutput 与 parsedExtraction，可在不再次调用 Provider 的情况下恢复。

现场恢复前已安全关闭 VOTC，并备份原 recovery snapshot 与相关既有人物摘要。恢复复用了已保存的 parsedExtraction，Provider 调用次数为 0；三个参与者目录各新增 2 个本次有向视角记录，共 6 个 Engine 2.4 文件通过 `finalizationId`、版本和内容核验，成功后原 recovery snapshot 按正常提交语义清除。

### 信件回信送达热修

实机日志显示回信与信件摘要均已生成，但回信按来信设定仍需等待旅行延迟：本次 `letter_3` 的生成日为 414673，预计送达日为 414696。问题不在 Provider 或摘要，而在 v7.8 模块拆分后 `letter-manager.js` 仍调用未注入的 `cleanLogFile`；日期日志监听因此周期性报告 `tail_error`，延时送达不再可靠。

热修让信件监听只负责读取 `VOTC:DATE`，不再改写正在监听的 CK3 日志。待送回信及状态保存在 VOTC 数据目录的 `pending-letters.json`，应用重启后自动恢复；生成时同时以当前来信日期校准日期基线。送达改为等待 `letters.txt` 成功写入 `create_artifact` 与 `message_event.362` 后再删除队列项，CK3 路径缺失或文件写入失败时保留回信并在后续日期更新重试。

## 发布回归补强

- `scripts/test-v7.8.2-final-v7-hotfix.js` 直接加载真实路径配置、TemplateEngine、打包默认 helpers 和 Character，验证 helper 目录合同及特质删除。
- `scripts/test-v7.8.2-full-prompt-smoke.js` 使用真实 `default.hbs`、`letter.hbs`、helpers、PromptScriptSandbox、PromptBuilder 和 LetterPromptBuilder，覆盖完整对话与信件 Prompt 组装、稳定缓存块顺序及模板实际输出。
- `scripts/test-v7.7.2-staged-presence.js` 增加唯一 NPC 暂离/返回回归，并验证多次缺席的终局配对摘要不会泄漏任何窗口间隙内容。
- `scripts/test-v7.8.2-letter-delivery.js` 覆盖日期推进、旅行延迟、应用重启恢复、首次送达失败重试，以及最终宝物创建和回信弹窗指令。
- 统一发布清单增至 42 组，覆盖 75 个 `test-*.js` 文件；36 条轻量语义金标样例保持不变。

## V8 延后事项

- `gameData.dynasty` 的数据源和更新时机需要在 V8 动态历史边界中统一，避免在 V7 热修中并行维护第二套朝代状态。
- `updateCurrentEmperorInfo` 的解析、状态更新与 Prompt 消费职责需要在 V8 继续收束；本版本只记录，不重构该链路。

## 验收边界

本地 `node scripts/test-release.js` 已通过 42/42 个发布组并覆盖 75 个测试文件；打包 `VOTC.exe` 隐藏启动冒烟中 4 个 Electron/VOTC 进程均可响应，结束后无残留进程。真实 Provider 请求、真实 CK3 日志联动、GitHub Actions、提交与标签仍属于发布前人工冻结门禁；本次实现没有消耗用户 API 配额、修改实际游戏状态或代替用户创建提交和标签。
