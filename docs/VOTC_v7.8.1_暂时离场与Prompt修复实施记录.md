# VOTC v7.8.1 暂时离场与 Prompt 修复实施记录

## 目标

本版本修复 v7.8 模块拆分后首次完整对话或信件 Prompt 构建暴露的依赖缺失，并在不改变 v7.7.2 候场、请入内和永久请离场语义的前提下，增加可返回的暂时离场状态。Memory Engine 版本保持 2.4，安装包元数据保持 2.0.4，应用功能基线更新为 v7.8.1。

## Prompt 修复

- `TemplateEngine` 通过工厂显式接收 `PromptScriptSandbox`，默认 helper 目录直接使用已注入的 `defaultPromptsDir`，不再引用模块中不存在的 `electron`。
- `PromptBuilder` 恢复描述脚本的稳定人物资料与动态日期片段切分方法，保留缓存前缀顺序。
- `LetterPromptBuilder` 显式接收 `logVerboseLLM`，信件 Prompt 构建不再因未定义 logger 失败。

## 人物状态与 UI

首句前仍只显示“请入内 / 设为候场”。对话开始后，在场人物显示“暂时离场…”选择器和独立的“请离场”按钮；选择器包含“昏迷 / 睡着 / 暂时离开”。暂离人物按模式显示“唤醒 / 叫醒 / 请回来”，永久离场保持禁用且不可返回。

暂离会立即停止该人物的回应队列与动作参与资格，并关闭当前在场窗口。返回时写入针对该人物的状态提示：人物知道自己曾昏迷、睡着或离开，但明确不知道缺席期间发生的对话和事件。返回不会热插队补话。人物返回后可再次选择任意一种暂离模式，次数不设上限；每次暂离与返回都会追加一组独立在场窗口。

## Memory Engine 2.4 边界

同一人物可以拥有多个 `[joinedAtMessageId, leftAtMessageId)` 窗口。暂离期间不发起额外摘要请求，也不会把窗口间隙消息写入该人物的 Prompt 历史、动态知情、滚动摘要或最终配对视角摘要。返回状态消息位于新窗口起点，因此只提供自身状态和知识边界。

Knowledge Service 改为先按人物聚合窗口，再逐个来源消息验证是否落入该人物任一窗口。这样缺席前和返回后都亲历的事件可以正确记忆，只要任一来源位于缺席间隙就不会向该人物泄漏。

## 验证

- `node scripts/test-v7.8.1-prompt-dependencies.js`
- `node scripts/test-v7.7.2-staged-presence.js`
- `node --check resources/app/out/main/main.js`
- `node scripts/test-release.js`

自动化覆盖 helper 沙箱与目录注入、描述缓存切分、信件 logger、三种暂离提示、同一人物连续三次暂离与返回、多段历史可见性、共享 rolling summary 禁用、Knowledge 多窗口聚合、UI/IPC 合同及原有候场/入内/永久离场回归。真实模型输出和 CK3 动作落地仍属于发布前手动冒烟范围。
