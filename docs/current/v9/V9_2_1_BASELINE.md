# V9.2.1 缓存专项基线

日期：2026-10-12。依据用户提供的 [施工规格](V9_2_1_IMPLEMENTATION_SPEC.md)，仅处理 Durable 动态额度、GLM 当前 V8.13 出站审计和必要的缓存诊断。V9.3 Provider Platform、V9.4 PromptPlan 和后续阶段范围不变；本文件不代表缓存收益已达标。

## 来源与证据

- 开工 `main` HEAD：`6026713d88deeafef6cf45e6a07405908c98e030`，开工工作区干净，无分支或 worktree。
- V9.2 Release Regression [run 38197734316](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/38197734316)，对应 `6026713`，Success。V9.2 功能反馈按用户规格记录为 `USER_CONFIRMED`，不代替缓存 A/B 或 Soak。
- 当前项目 V9.2 / App 9.2.0 / Workshop 2.0.5 / Memory 显示 4.0、协议 3.0、存储 2.5。候选未冻结前保持此发布版本。
- 用户明确授权人民币 **10 元**真实 Provider 实验上限，不增加自动重试或无界收费请求。

## 数据保全与运行配置

用户明确批准仓库外受限私有目录；权限仅授予当前用户、SYSTEM 和管理员。业务数据、用户 Prompt、设置、凭据文件及 UI 配置逐字节备份，3,758 files / 626,495,843 bytes；代码与回滚文件 577 个。备份清单、凭据、角色正文及私有路径不进入公开仓库。Chromium 浏览器缓存不属于本版修改目标，也未纳入业务备份。

首次备份清单摘要 SHA-256：`47b1a42628766e300f82622ceab9ec7c6bfb060bb7661af4aaea18a32be47a05`。应用随后由用户完全退出；退出时一项业务文件发生变化，已在同一受限私有备份中追加新字节并保留旧版。关闭后基线为 3,758 files / 626,496,659 bytes，清单 SHA-256：`c9c90020cb0954c8e3371fa6aba021d0733714dd4721a3c0c2b0a03a184446c4`。不将关闭期间的变化归于源码修改。

只读确认：Chat 为 `zhipu / glm-5.3-flash`，端点 `https://open.bigmodel.cn/api/paas/v4`，`glmReasoningEffort=high`，`glmClearThinking=true`；Summary 与 Action 指向 `deepseek / deepseek-v4-flash`，端点 `https://api.deepseek.com`。不改任何用户配置或模型名。真实 Chat `layoutId=v813`；Provider profile 标签不代表实际使用旧 GLM Cache v2 布局。

## 历史保留窗口

只读 usage 窗口：2026-10-08 22:36:08.307 至 2026-10-12 02:01:40.501（Asia/Shanghai），共 2,000 条用量请求。它是保留历史聚合，不是冻结 V9.2 的受控实验。

| 路由 | 请求 | 原生缓存报告 | 原生零 | 缺失/未知 | 加权命中率 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Chat / zhipu / glm-5.3-flash | 563 | 534 | 170 | 29 | 36.0167% |
| memory4_durable / deepseek / deepseek-v4-flash | 372 | 372 | 0 | 0 | 59.9294% |

GLM 的 29 条未知不填零、不进入命中率分母。此前截图与本表的笔数或比例差异不能解释为版本提升。诊断日志另保留 500 条请求，窗口 2026-10-09 23:52:31.635 至 2026-10-12 01:55:52.575；Chat 布局均为 `v813`。当前历史记录不具备完整显式 cold/warm/cohort 标签，不能伪造 warm-only 收益。

## 本地 Gate

`verify-runtime-build.js --deployed`：286 source/artifact hashes PASS；`runtime-dependencies.js`：5,981 files / 264 packages PASS。

完整原 V9.2 `test-release.js` **418/418 PASS，exit 0**。初次沙箱尝试因 Windows 临时目录 rename 权限受限退出；主机尝试发现应用运行并拒绝部署夹具。用户退出后重新从头运行，未修改断言或跳过门禁。G0 已通过本地完整基线与备份核验。

脱敏 [基线 JSON](v9.2.1-cache-baseline.json) 将 usage 与 500 条诊断作为独立 population，明确未知缓存、估算 Token 排除以及重叠的归因维度。361 条保留 GLM Chat 诊断中，317 次同回应角色比较的冻结前缀不变；2 次变化的最早区块均为 `memory-direct-frozen`，无法仅凭 hash 判断具体触发原因，不归罪于静态规则。224 次回应角色切换、10 次会话切换与 62 次同端点大估算前缀原生零命中采用不同/重叠口径，不能相加当作可节省量。
