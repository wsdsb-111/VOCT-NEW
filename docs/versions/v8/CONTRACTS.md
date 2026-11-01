# CONTRACTS 版本册

原文按来源合并，保留设计、实施、修复、失败与待验结论；历史文字中的“当前”只属于其原版本。源码快照：`9449b0a4bc6b0616452b31fb8c79eafeae829bf5`。旧页仅保留链接兼容索引。

- [V8_FREEZE_EVIDENCE.md](#source-d09c224842a6)

<!-- chapter:source-d09c224842a6:start -->
<a id="source-d09c224842a6"></a>
## 来源：docs/current/v9/V8_FREEZE_EVIDENCE.md

原文规范化 SHA-256：`b7f3a4aa61908cf4198194da0fe887945e756da588b10183f4336cb71b2843a7`。

<a id="source-d09c224842a6--v8-冻结证据"></a>
# V8 冻结证据

日期：2026-10-11；V9 工作分支 `codex/v9.0-engineering-baseline`。

- 冻结提交：`3c49364fb1f9d4f1a90c6c09df3cc3966a01b8c4`，施工前工作区干净，与设计文档一致。
- V8 原始完整命令 `node scripts/test-release.js`：**409/409 PASS、exit 0**。本地 Node v24.13.0；CI指定Node22，不能合并证据等级。
- Git冻结标签未创建；main保持原SHA，V9在工作分支施工，不自动提交或推送。
- 逐文件校验 7079 个实际跟踪文件与68个已实体化LFS文件；清单见 [冻结资产](../../current/v9/v8-frozen-assets.json)。`VOTC.exe` SHA-256：`287e302fb03013240cef38e3084af5a87d2dfc188e72594189cca8875381bb6a`；App包版本2.0.4不等于功能V9版本。
- 仓库外完整源码archive、实际LFS副本、3536个用户数据文件（604895003字节）、7份当前Workshop桥文件和13份已安装兼容Mod均已复制并验证。施工时未检测到VOTC进程；失败的首轮备份由于Windows长路径限制，使用扩展路径在同一备份续作后完整通过，没有删除原文件。
- 私人备份位置：本机TEMP下 `votc-v8-freeze-20261011-1e6e756b721e442a880d0653dede1acd`。用户数据manifest/正文只在该私人目录，未纳入Git。恢复须先停应用并复验当前状态，不能对主用户数据盲目覆盖或重放效果。
- Workshop item：3346777360；实际7份桥与源码快照比较结果见资产manifest。原三Mod和E盘兼容安装不修改。
- 环境：Windows_NT 10.0.26200 x64，AMD Ryzen 7 7840H，16逻辑处理器，约15GiB物理RAM（Node总内存计量）；Steam CK3 build ID 25652598。CK3内部版本、存档年份、帧时间、存储介质本轮未测，不以null/零值冒充结果。

既有用户功能验收保留为V8历史证据。新V9的CI、打包、CK3、Provider及性能结论在[本轮报告](../v9/V9.0.md#source-7f8563a38eee)分别登记。

<!-- chapter:source-d09c224842a6:end -->

