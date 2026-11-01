# V9.7 基线冻结（2026-11-01）

本轮直接在 main 开发。设计见 [V9.7 工程方案](V9_7_DETAILED_ENGINEERING_SPEC.md)。方案中的工作分支建议由用户既有 main 约定覆盖。

| 项目 | 实际冻结证据 |
| --- | --- |
| HEAD | `3721b925270457175e0e583f943a20db581de03e`，功能提交 `7d05c3d11e8296ca1de93a7faf2a371c99288604` |
| Core/App/UI | 9.6.1；版本升级只影响新候选源码与隔离产物 |
| 源码/构建/本机安装 | `node scripts/verify-runtime-build.js --deployed` 通过 353 个映射 |
| 基线 payload | `02c9cbf97be6ffb0a2d4d3e5313ad51132d877daf046f33a96e5309be3e7869a` |
| EXE 壳 SHA-256 | `287e302fb03013240cef38e3084af5a87d2dfc188e72594189cca8875381bb6a`；壳文件属性不是 Core 版本 |
| 发布/归档 | 519 发布组、127 归档检查；本轮不转出任何原发布组 |
| 既有完整 CI | [3721b925 / 41264613076](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/41264613076)，本轮查询确认各步骤 success；这是基线证据，不代表 V9.7 |
| 对外协议 | Workshop 2.0.5（官方上游 2.0.4）、Bridge 1、日志 3.0、摘要存储 2.5、Official Action 2.0.3 |
| 范围外内容 | 工作区原有 screenshots、视觉 tar.gz、sites 未纳入本轮 |

在任何 Runtime 修改前，353 个基线产物、原 manifest、部署回执和匿名指纹已保存至忽略目录 `.build/v97-baseline/`。该快照不含 node_modules、EXE 副本或用户数据。Git 原提交是长期回滚来源；本地快照只辅助比对，不成为召回源。

隔离夹具：`scripts/fixtures/v9.7/finish-v961.js` 固定原 finish adapter；`ipc-baseline.json` 固定 184 个 Preload 路由、174 个注册 handler。Prompt 复用既有 V9.4 全消息 Golden（含已批准 V9.6 身份增量），七 Provider 复用 V9.3 outbound Golden。数据与故障夹具沿用现有 Legacy/Forget/Pair/Canon/Letter/RunFile 合成测试，另增加 V9.7 读前后全文件哈希验证，禁止从 APPDATA 复制真实数据。

固定历史仍为完整 Recent2、合法官方追忆及完整合法 Pair 事项簿；设计 3C 的“最近一篇”不作为检索语义变更授权。五代亲属、身份遮盖、手动隐藏、Canon 同日确认/重启/4096 Token 和所有来源/Forget/预算合同保持。

V9.7 本机只构建 `.build/runtime`，不自动部署。新源码和旧安装有意分离；准确新 SHA 的隔离 Windows CI 负责 materialize、353 项部署一致性和完整 EXE 冷启动/重启/IPC/媒体验证。真实 CK3、付费 Provider、本机输入及 Soak 不由此签署。
