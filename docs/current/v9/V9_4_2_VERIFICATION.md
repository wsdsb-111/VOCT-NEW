# V9.4.2 验证记录

日期：2026-10-22。完整门禁、打包 EXE 与真实 CK3／Provider 分开签署。

- 独立静态审查确认聊天 19 条请求的冻结指纹未变，确认 Action 动态身份与可用动作早于固定示例的问题。
- 本机 Node 22 使用 384 MB 堆上限，专项串行通过：RC5 overlay/stable prefix（含真实 DeepSeek adapter 两种 schema 模式、不同回应者／玩家／可用动作／非空动作记录）、关系动作召回、DeepSeek Action adapter、V9.4.1 静态分类54例、来源权限、PromptPlan schema、主题样式、官方动作合同及测试清单。清单仍为616测试文件、488发布组、127历史归档。
- Runtime dependencies 5,981文件／264包通过；source build、verify、deploy、deployed verify 均通过，306项资源一致，App 9.4.2，payload `b422e5772db9994cd9fd2257260889a1eae9cc7b549b14efb30bd8513ec75002`。首次沙箱原子重命名 EPERM，同一构建在已授权权限下成功；没有改变系统防护。
- 排查时额外运行的 `test-v7.9.2-structured-schema-analytics.js` 在旧 Social Consequence schema 断言失败；该文件已在测试清单历史归档，不是当前发布组，也不据此恢复已退役行为。当前官方动作专项与本次修复专项均通过。完整发布结果待准确 SHA 的远端 CI，不引用9.4.1结果充当本版通过。
- 本机大型发布门禁和完整分发复制不运行；隔离 Windows CI 执行完整回归、完整分发 EXE 冷启动／重启及实际媒体加载。
- 真实 CK3、新请求缓存命中率、用户桌面操作与 Soak：NOT_RUN。原聊天暖前缀零命中的服务商原因：UNKNOWN。
- 无新增付费 API 请求。原始日志、人物资料、摘要、分析数据与密钥不提交；本报告仅保留聚合计数和代码结论。

## 准确提交的远端结果

代码提交 `e9d7d6f0e5d1afa12c7dfc275edec2258f7dfa13` 已推送 main；[Windows CI 39651824091](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39651824091) 全部成功。日志核验 **488组发布回归、306项构建／部署、完整分发 EXE 冷启动与重启**，App与版本IPC均为9.4.2；实际分发的ffmpeg.dll加载及PCM媒体解码通过，两次启动无运行时异常。远端payload为 `b422e5772db9994cd9fd2257260889a1eae9cc7b549b14efb30bd8513ec75002`，与本机完全一致。

后续本条证据与索引补录只修改文档，不改变该代码／生成资源。真实CK3、本机桌面输入、服务商新请求原生命中率与Soak仍未执行；不能把远端自动化成功解释为这些Gate通过。工作区既存未跟踪的sites目录未修改或提交。
