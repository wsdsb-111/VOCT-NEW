# V9.7 验证记录

## 已完成的本机检查

源构建 `node --max-old-space-size=384 scripts/build-runtime.js` 与 `verify-runtime-build.js` 通过 **353 映射**，payload `a8d9305b3941c80f3155893ec97a71e0f5bed69c23fd73f8285dff26c5bd7567`。第一次 sandbox rename EPERM 使旧 artifact 留在原位，未通过验证；批准后重试构建/验证成功，不掩盖该失败。没有本机 deploy。

以下 18 项用单个 Node 进程逐项执行、堆上限 384MB，全通过：

- V9.7 production-reference-audit / provider-compat / prompt-plan-parity / legacy-data-readonly 四项。
- V9.4 legacy-layout-golden / plan-schema / provider-effective-request / conversation-plan-main-chain 四项。
- V9.3 adapter-conformance（七 adapter / 39 frozen wire 场景）与 result-usage。
- V9.3.4 legacy-forget、V9.3.5 pair-ledger。
- V9.6.1 world-memory-restart-budget、relationship-recognition-regression。
- V7.10 rc6-rev3-run-command-recovery、V8.15.2 letter-receipt-startup-recovery。
- test-test-manifest：652 test 文件、524 release groups、127 archived checks。

adapter-conformance 在源码版本升级后第一次失败：夹具读旧安装 package 导致 User-Agent VOTC/9.6.1 与源码候选9.7.0不符。改为读取被测源码 package 后通过；没有更新 Golden 或放宽断言。

基线所有 353 文件 manifest 已冻结。新引用测试逐项验证映射不增删，除明列 6 项外 **347 项源码哈希不变**；5 项为版本标签，第 6 项是已比对的 Provider 不可达分支。包依赖未升级。

## 独立审查与外部验证

Terra/high 两轮只读审计：未发现可直接删除的完整生产路径；提出的异常 options、IPC 文本矩阵局限及 Legacy 只读声明收窄已处理。独立审查不是实际 CK3/Provider 测试。

V9.7 准确 SHA 的完整 Windows CI、隔离部署/完整 EXE 和最终独立审查尚待本轮提交后登记。V9.6.1 [41264613076](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/41264613076) success 只是基线，不作为本版通过证据。

| Gate | 当前证据 |
| --- | --- |
| 本机源码/隔离 artifact | PASS；353 项；新 payload 如上 |
| 本机 V9.7 安装/人工冒烟 | NOT_DEPLOYED / NOT_RUN；原 V9.6.1 安装保留 |
| V9.7 exact-SHA Release/EXE | PENDING，禁止用旧 CI 替代 |
| CK3 / Provider | CK3_LIVE_PENDING / PROVIDER_LIVE_PENDING；未发付费请求 |
| 2h / 100+ 回合 Soak | 留给 V9.8 RC，不宣称 Full Freeze |

本机完整 release 不执行，遵守资源约束；完整门禁在隔离 Windows CI 执行。后续文档合并另做源文完整性、链接/锚点和版本归属验证，并登记实际数量。

首次 V9.7 CI：`b7459369163c3fd4214fdf3cdd44601ffa43b984` / [41283699861](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/41283699861) **FAILED**，构建与源产物哈希已通过，初始部署因旧资源与新 stage 不同且没有 receipt 被 `build_deploy_initial_target_unknown` 拒绝；release/EXE 未执行。新增仅限 GITHUB_ACTIONS 且 GITHUB_WORKSPACE 等于受测根的基线收据引导，严格比对冻结的353项旧资源，才由原部署事务升级。普通用户部署保护未改。新增 ci-baseline 正反例已通过，发布清单524组。
