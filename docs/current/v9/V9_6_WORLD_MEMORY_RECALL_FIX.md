# V9.6 世界记忆动态召回接线修复

日期：2026-10-26。沿用 Core／App／UI 9.6.0 候选、Workshop 2.0.5 和现有存储格式；不改 Prompt block ID 或缓存锚点。

## 根因与证据

用户反馈新增世界记忆没有召回。只读检查当前分支的 4 条记录，均为有效、公开、非 conversationStable 的普通 PLAYER_CANON，没有保存失败或被隐藏。以本机当前游戏日期逐条按标题离线回放生产 Canon 检索，4／4 均能匹配，日期和可见性不是这组样本的阻断原因。没有复制原文、日志、分支 ID 或凭据到仓库。

遗漏发生在 V813 对话主链：开场以 CONVERSATION_BASELINE 构造冻结视图，正确地不纳入普通 Canon；后续 CURRENT／UNSPECIFIED 查询只补 CK3 世界事实的 coverage patch，未调用普通 Canon 检索。记录仍在磁盘，也能通过单项召回检查，但没有进入这条聊天路径的最终 Prompt。

## 修复

- 新增内部 `WorldlineService.getCanonTurnRecallAsync`，准备当前 Canon 后取得回应者获准事实，复用现有 `canon.recall`。普通记忆仍经过相关性、Campaign／Branch、日期、NPC 可见性、当前状态冲突和完整记录预算检查；功能开关在异步准备后再次复核。
- V813 当前／未指定时间查询保留原覆盖补丁，再把获准 Canon 加入既有 `worldline-coverage-patch` 动态块。不会重复注入整份世界事实，不把普通剧情记忆写入开场冻结区；历史及近期查询继续走原路径。
- 固定规则返回实际选中的 stableCanonRecordIds，后续只排除当前回应者开场确已冻结的记录。未被开场收录的规则不会仅因标记 stable 而从动态查询消失。
- 每轮从 Canon 当前修订召回，不复用 coverage patch 的旧 Canon 文本；隐藏、删除、编辑和切分支沿用现有失效机制。先扣掉覆盖补丁与分隔开销，Canon 预算不超过余量及 512 Token，最终完整请求预算检查保留。
- 使用已有 supplemental 统计字段记录候选、选中、修订、Token 及阻断计数；没有增加模型请求。

独立静态复审确认上述稳定 ID、时间分流、预算和 ACL 边界，没有要求放宽原过滤。

## 验证与交付

新增并登记 `test-v9.6-world-memory-recall-independent-qa.js`。使用合成临时分支、实际 WorldlineService／CanonService、Conversation.checkAndSummarizeIfNeeded 与最终 PromptBuilder；仅对旧 coverage patch 使用哨兵，以验证它与 Canon 同时保留。

覆盖 4 条普通记忆在最终 Prompt 中各出现一次、固定规则只出现一次、动态位置在稳定前缀之后、换查询时前缀指纹不变、空查询和关闭功能、异步准备期间关闭、隐藏更新、错分支、未来记录、秘密不可知、未验证当前状态、极低预算及历史不误入当前召回。测试不读取真实用户数据、不调用 CK3 或 Provider。

本机单进程、384MB 串行通过 13 项：新增独立 QA、冻结前缀、coverage patch、生产 Canon、Checkpoint 前进、长期规则、计划、单项测试 API、Supplemental 检索、七布局 Golden、静态优先顺序、Forget 及测试清单。完整清单现为 512 组。

352 项资源已按源码构建、验证、部署并核对一致，payload 为 `533b34c9b4cf176c559893dc515dc2cd1080f608bd92747ba954d545b33a1f3a`。真实记录只读回放 4／4 匹配与自动化主链验证分开记录；尚未执行真实模型新回复或 Soak。完整发布门禁和 EXE 检查交隔离 Windows CI，按准确提交补记结果。

最终代码 `1b361d57868a2e2ba26b80c51efc8175e57ba0ca`／[Windows CI 40219544407](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/40219544407) 为 SUCCESS：512 组完整发布回归、352 项构建／部署核验、独立 Mod 产物及完整 EXE 冷启动／同配置重启／媒体解码检查全部通过。远端 payload 与上述本机部署一致；后续文档记录不改变该代码与产物。真实 CK3 对话措辞和 Soak 仍未验收，没有新增付费请求。

原有世界记忆、摘要、存档、设置和队列未修改；未上传 Steam。重启 VOTC 后按记忆相关内容提问复测，不需要重新创建这 4 条记录。召回仍按相关性和预算选择，不是把所有保存的记忆每轮全部发送。
