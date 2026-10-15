# V9.3.4 变更清单

运行构建原296项，当前278项。删去的21个映射见下表；通用 entity-context、legacy-source-lineage、letter-summary-finalization迁入原源码构建，无第二Store。Legacy UI从旧容器独立，保留编辑、删除、模型整理、正文、重要事项、官方只读、日期与分页；Forget独立沿原index和journal。Generated资源全部由build/deploy产生。

## 退役运行文件

- src/app/main/memory-system/memory4-contract.js 及对应 resources/app/out/main/memory-system/memory4-contract.js
- src/app/main/memory-system/memory4-coordinator.js 及对应 resources/app/out/main/memory-system/memory4-coordinator.js
- src/app/main/memory-system/memory4-coverage.js 及对应 resources/app/out/main/memory-system/memory4-coverage.js
- src/app/main/memory-system/memory4-disclosure.js 及对应 resources/app/out/main/memory-system/memory4-disclosure.js
- src/app/main/memory-system/memory4-evidence-planner.js 及对应 resources/app/out/main/memory-system/memory4-evidence-planner.js
- src/app/main/memory-system/memory4-forget.js 及对应 resources/app/out/main/memory-system/memory4-forget.js
- src/app/main/memory-system/memory4-legacy-bridge.js 及对应 resources/app/out/main/memory-system/memory4-legacy-bridge.js
- src/app/main/memory-system/memory4-orphan-audit.js 及对应 resources/app/out/main/memory-system/memory4-orphan-audit.js
- src/app/main/memory-system/memory4-profile.js 及对应 resources/app/out/main/memory-system/memory4-profile.js
- src/app/main/memory-system/memory4-recall-planner.js 及对应 resources/app/out/main/memory-system/memory4-recall-planner.js
- src/app/main/memory-system/memory4-relationship-readback.js 及对应 resources/app/out/main/memory-system/memory4-relationship-readback.js
- src/app/main/memory-system/memory4-retirement-migration.js 及对应 resources/app/out/main/memory-system/memory4-retirement-migration.js
- src/app/main/memory-system/memory4-source-validity.js 及对应 resources/app/out/main/memory-system/memory4-source-validity.js
- src/app/main/memory-system/memory4-store.js 及对应 resources/app/out/main/memory-system/memory4-store.js
- src/app/main/memory-system/memory4-visibility.js 及对应 resources/app/out/main/memory-system/memory4-visibility.js
- src/app/main/memory-system/scoped-json-repository.js 及对应 resources/app/out/main/memory-system/scoped-json-repository.js
- src/app/main/analytics/durable-request-trace.js 及对应 resources/app/out/main/analytics/durable-request-trace.js
- src/app/main/memory-system/letter-memory-finalization.js 及对应 resources/app/out/main/memory-system/letter-memory-finalization.js
- src/app/main/memory-system/memory4-entity-context.js 及对应 resources/app/out/main/memory-system/memory4-entity-context.js
- src/app/renderer/memory4-manager.js 及对应 resources/app/out/renderer/memory4-manager.js
- src/app/renderer/memory4-manager.css 及对应 resources/app/out/renderer/memory4-manager.css

其中7个Year/Life手动维护依赖保留于scripts/archive/v933-year-life，绝不进runtime；其余历史实现可由锁定基线Git取证。用户历史数据不在此删除清单。

## 测试逐项归档

- test-v9.2-independent-qa.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.14.2-closeout-independent-qa.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.14.2-disclosure-fact-epoch.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.14.2-nickname-target-alias.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.14.2-third-party-disclosure.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.14.2-naming-disclosure-independent-qa.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.14.2-age-disclosure.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.14.2-disclosure-source-incident.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.14.2-memory-entity-naming.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.14.2-incident-independent-qa.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.14.2-letter-disclosure.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.14.2-disclosure-production-qa.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.14.2-disclosure-ui.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.14.2-disclosure-core.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.14-de-independent-qa.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.14-c-recall-planner.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.14-b-profile.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.14.1-memory-closeout.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.14-e-memory-ui.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.15-orphan-audit.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.15.2-age-claims-independent-qa.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.15.2-age-disclosure.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.15.2-ui-races.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.15.2-provider-visible-traits.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.15.2-disclosure-grammar.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.15.2-direct-observation.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.15.1-recall-ui.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.15.1-disclosure.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.15.1-memory-recovery.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v9.2.1-cache-invariants.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v9.2.3-derived-recovery.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v9.2.3-derived-retirement.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v9.3.2-durable-pipeline.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v9.3.2-independent-qa.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v9.2.1-durable-cache-policy.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v9.2.2-durable-lineage.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v9.2.2-durable-attribution.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v9.2.2-durable-chunking.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v9.2.2-presend-forget.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.14-a-durable-core.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.14.2-durable-generation-incident.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v8.14.1-memory4-archival-readonly.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v9.3.3-evidence-planner.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v9.3.3-source-validity.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v9.3.3-independent-qa.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v9.3.3-memory4-coverage-ui.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v9.3.3.1-coverage-interactions.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。
- test-v9.2-scoped-json.js：旧Durable／Memory4合同；有效Legacy与通用平台部分由保留混合脚本及本轮专项覆盖。

## 混合测试的历史分块

- test-v8.15.1-retired-memory4-independent-qa.js：保留原Memory4分块，仅锁定旧基线取证，不参加新版发布门禁。
- test-v8.15-retired-durable-entity-recall.js：保留原Memory4分块，仅锁定旧基线取证，不参加新版发布门禁。
- test-v8.15-retired-durable-production-contracts.js：保留原Memory4分块，仅锁定旧基线取证，不参加新版发布门禁。
- test-v8.14.2-retired-memory4-ui-edit.js：保留原Memory4分块，仅锁定旧基线取证，不参加新版发布门禁。
- test-v8.14-a-p0-retired-durable.js：保留原Memory4分块，仅锁定旧基线取证，不参加新版发布门禁。
- test-v8.15-fix1-retired-durable-audit.js：保留原Memory4分块，仅锁定旧基线取证，不参加新版发布门禁。

## 新发布专项

- test-v9.3.4-legacy-crud-qa.js
- test-v9.3.4-deployment-recovery-qa.js
- test-v9.3.4-legacy-forget.js
- test-v9.3.4-legacy-retirement.js
- test-v9.3.4-legacy-recall.js
- test-v9.3.4-no-durable-outbound.js
- test-v9.3.4-independent-qa.js

## 所有工作文件

状态为相对锁定基线的Git工作区分类；D指生产源码／生成文件退役，??指新增。运行日志、.build、私有备份和userdata均不提交。

| 状态 | 路径 |
|---|---|
| M | .gitattributes |
| M | AGENTS.md |
| M | build/runtime-inputs.json |
| M | CHANGELOG.md |
| M | docs/AGENTS.md |
| ?? | docs/current/v9/V9_3_4_CHANGED_FILES.md |
| ?? | docs/current/v9/V9_3_4_DURABLE_RETIREMENT_IMPLEMENTATION_SPEC.md |
| ?? | docs/current/v9/V9_3_4_IMPLEMENTATION_REPORT.md |
| ?? | docs/current/v9/V9_3_4_RETIREMENT_AUDIT.json |
| ?? | docs/current/v9/V9_3_4_VERIFICATION_REPORT.md |
| M | docs/README_摘要系统.md |
| M | docs/README.md |
| M | package.json |
| M | README.md |
| M | resources/app/out/main/AGENTS.md |
| D | resources/app/out/main/analytics/durable-request-trace.js |
| M | resources/app/out/main/application/service-ports.js |
| M | resources/app/out/main/conversation/conversation-manager.js |
| M | resources/app/out/main/conversation/conversation.js |
| M | resources/app/out/main/game-data/game-data.js |
| M | resources/app/out/main/ipc/register-ipc.js |
| M | resources/app/out/main/letters/letter-manager.js |
| M | resources/app/out/main/main.js |
| ?? | resources/app/out/main/memory-system/entity-context.js |
| M | resources/app/out/main/memory-system/incident-diagnostics.js |
| ?? | resources/app/out/main/memory-system/legacy-source-lineage.js |
| D | resources/app/out/main/memory-system/letter-memory-finalization.js |
| ?? | resources/app/out/main/memory-system/letter-summary-finalization.js |
| M | resources/app/out/main/memory-system/memory-engine.js |
| M | resources/app/out/main/memory-system/memory-store.js |
| D | resources/app/out/main/memory-system/memory4-contract.js |
| D | resources/app/out/main/memory-system/memory4-coordinator.js |
| D | resources/app/out/main/memory-system/memory4-coverage.js |
| D | resources/app/out/main/memory-system/memory4-disclosure.js |
| D | resources/app/out/main/memory-system/memory4-entity-context.js |
| D | resources/app/out/main/memory-system/memory4-evidence-planner.js |
| D | resources/app/out/main/memory-system/memory4-forget.js |
| D | resources/app/out/main/memory-system/memory4-legacy-bridge.js |
| D | resources/app/out/main/memory-system/memory4-orphan-audit.js |
| D | resources/app/out/main/memory-system/memory4-profile.js |
| D | resources/app/out/main/memory-system/memory4-recall-planner.js |
| D | resources/app/out/main/memory-system/memory4-relationship-readback.js |
| D | resources/app/out/main/memory-system/memory4-retirement-migration.js |
| D | resources/app/out/main/memory-system/memory4-source-validity.js |
| D | resources/app/out/main/memory-system/memory4-store.js |
| D | resources/app/out/main/memory-system/memory4-visibility.js |
| D | resources/app/out/main/memory-system/scoped-json-repository.js |
| M | resources/app/out/main/memory-system/summary-folder-merge.js |
| M | resources/app/out/main/prompts/letter-prompt-builder.js |
| M | resources/app/out/main/prompts/prompt-builder.js |
| M | resources/app/out/main/prompts/trait-profile-selector.js |
| M | resources/app/out/main/provider-service.js |
| M | resources/app/out/main/summaries/summaries-manager.js |
| M | resources/app/out/main/version.js |
| M | resources/app/out/preload/preload.js |
| M | resources/app/out/renderer/assets/index-Dn3qWlAB.js |
| M | resources/app/out/renderer/index.html |
| D | resources/app/out/renderer/memory4-manager.css |
| D | resources/app/out/renderer/memory4-manager.js |
| M | resources/app/out/renderer/summary-date-order.js |
| M | resources/app/out/renderer/ui-comfort.css |
| M | resources/app/package.json |
| M | scripts/AGENTS.md |
| ?? | scripts/archive/ |
| M | scripts/repair-confirmed-letter-memory.js |
| M | scripts/retire-year-life-v933.js |
| M | scripts/test-manifest.js |
| M | scripts/test-memory-ui.js |
| M | scripts/test-v7.1-memory-engine.js |
| M | scripts/test-v7.2.1-stability.js |
| M | scripts/test-v7.7.4-stability-infrastructure.js |
| M | scripts/test-v7.8-main-modularization.js |
| M | scripts/test-v8.10.2-memory-deletion.js |
| M | scripts/test-v8.11.1-summary-consistency.js |
| M | scripts/test-v8.12-safety-closure.js |
| M | scripts/test-v8.12.1-dual-temporal-memory.js |
| M | scripts/test-v8.14-a-finalization-visibility.js |
| M | scripts/test-v8.14-a-p0-memory-closeout.js |
| ?? | scripts/test-v8.14-a-p0-retired-durable.js |
| M | scripts/test-v8.14-a-sol-review.js |
| M | scripts/test-v8.14-hotfix-finalization.js |
| M | scripts/test-v8.14-summary-manual-regeneration.js |
| M | scripts/test-v8.14.1-frontend-content.js |
| M | scripts/test-v8.14.1-letter-knowledge.js |
| M | scripts/test-v8.14.1-production-pipeline-qa.js |
| M | scripts/test-v8.14.1-trait-profile-routing.js |
| M | scripts/test-v8.14.2-letter-memory-finalization.js |
| M | scripts/test-v8.14.2-letter-retry-independent-qa.js |
| ?? | scripts/test-v8.14.2-retired-memory4-ui-edit.js |
| M | scripts/test-v8.14.2-summary-edit-incident.js |
| M | scripts/test-v8.14.2-summary-retry-rebuild-incident.js |
| M | scripts/test-v8.15-durable-forget.js |
| M | scripts/test-v8.15-entity-recall.js |
| M | scripts/test-v8.15-fix1-independent-qa.js |
| ?? | scripts/test-v8.15-fix1-retired-durable-audit.js |
| M | scripts/test-v8.15-legacy-recall.js |
| M | scripts/test-v8.15-memory-prefix-invalidation.js |
| M | scripts/test-v8.15-production-contract-qa.js |
| ?? | scripts/test-v8.15-retired-durable-entity-recall.js |
| ?? | scripts/test-v8.15-retired-durable-production-contracts.js |
| M | scripts/test-v8.15.1-independent-qa.js |
| ?? | scripts/test-v8.15.1-retired-memory4-independent-qa.js |
| M | scripts/test-v8.15.2-letter-archive-independent-qa.js |
| M | scripts/test-v8.15.2-letter-receipt-startup-recovery.js |
| M | scripts/test-v8.15.2-letter-recovery-independent-qa.js |
| M | scripts/test-v8.15.2-letter-timer-retirement-qa.js |
| M | scripts/test-v8.15.2-world-summary-date-qa.js |
| M | scripts/test-v8.8-ui-style-backgrounds.js |
| M | scripts/test-v9.0-independent-qa.js |
| M | scripts/test-v9.2-renamed-summary-folders.js |
| M | scripts/test-v9.2-service-ports.js |
| M | scripts/test-v9.2.1-glm-v813-prefix.js |
| M | scripts/test-v9.2.3-glm-outbound-equivalence.js |
| M | scripts/test-v9.3-adapter-conformance.js |
| M | scripts/test-v9.3-independent-qa.js |
| ?? | scripts/test-v9.3.4-deployment-recovery-qa.js |
| ?? | scripts/test-v9.3.4-independent-qa.js |
| ?? | scripts/test-v9.3.4-legacy-crud-qa.js |
| ?? | scripts/test-v9.3.4-legacy-forget.js |
| ?? | scripts/test-v9.3.4-legacy-recall.js |
| ?? | scripts/test-v9.3.4-legacy-retirement.js |
| ?? | scripts/test-v9.3.4-no-durable-outbound.js |
| M | scripts/v8.15.2-letter-clock-smoke.js |
| M | src/AGENTS.md |
| M | src/app/main/AGENTS.md |
| D | src/app/main/analytics/durable-request-trace.js |
| M | src/app/main/application/service-ports.js |
| M | src/app/main/conversation/conversation-manager.js |
| M | src/app/main/conversation/conversation.js |
| M | src/app/main/game-data/game-data.js |
| M | src/app/main/ipc/register-ipc.js |
| M | src/app/main/letters/letter-manager.js |
| M | src/app/main/main.js |
| ?? | src/app/main/memory-system/entity-context.js |
| M | src/app/main/memory-system/incident-diagnostics.js |
| ?? | src/app/main/memory-system/legacy-source-lineage.js |
| D | src/app/main/memory-system/letter-memory-finalization.js |
| ?? | src/app/main/memory-system/letter-summary-finalization.js |
| M | src/app/main/memory-system/memory-engine.js |
| M | src/app/main/memory-system/memory-store.js |
| D | src/app/main/memory-system/memory4-contract.js |
| D | src/app/main/memory-system/memory4-coordinator.js |
| D | src/app/main/memory-system/memory4-coverage.js |
| D | src/app/main/memory-system/memory4-disclosure.js |
| D | src/app/main/memory-system/memory4-entity-context.js |
| D | src/app/main/memory-system/memory4-evidence-planner.js |
| D | src/app/main/memory-system/memory4-forget.js |
| D | src/app/main/memory-system/memory4-legacy-bridge.js |
| D | src/app/main/memory-system/memory4-orphan-audit.js |
| D | src/app/main/memory-system/memory4-profile.js |
| D | src/app/main/memory-system/memory4-recall-planner.js |
| D | src/app/main/memory-system/memory4-relationship-readback.js |
| D | src/app/main/memory-system/memory4-retirement-migration.js |
| D | src/app/main/memory-system/memory4-source-validity.js |
| D | src/app/main/memory-system/memory4-store.js |
| D | src/app/main/memory-system/memory4-visibility.js |
| D | src/app/main/memory-system/scoped-json-repository.js |
| M | src/app/main/memory-system/summary-folder-merge.js |
| M | src/app/main/prompts/letter-prompt-builder.js |
| M | src/app/main/prompts/prompt-builder.js |
| M | src/app/main/prompts/trait-profile-selector.js |
| M | src/app/main/provider-service.js |
| M | src/app/main/summaries/summaries-manager.js |
| M | src/app/main/version.js |
| M | src/app/package.json |
| M | src/app/preload/preload.js |
| M | src/app/renderer/assets/index-Dn3qWlAB.js |
| M | src/app/renderer/index.html |
| D | src/app/renderer/memory4-manager.css |
| D | src/app/renderer/memory4-manager.js |
| M | src/app/renderer/summary-date-order.js |
| M | src/app/renderer/ui-comfort.css |
| M | ui-theme-preview.html |
