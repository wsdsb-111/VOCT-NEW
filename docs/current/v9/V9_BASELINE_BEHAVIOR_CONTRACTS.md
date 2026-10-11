# V9 永久行为合同与回归映射

日期：2026-10-11。保留V8真实正反例，V9不修改这些语义；当前完整门禁会运行表中发布测试。

| 合同 | 不变量 | 现有正反例入口 |
| --- | --- | --- |
| B-MEM-01 | Campaign/Owner/跨NPC隔离 | [test-v8.15.2-stranger-memory-isolation-qa.js](../../../scripts/test-v8.15.2-stranger-memory-isolation-qa.js) |
| B-MEM-02 | Forget/Tombstone及重启不复活 | [test-v8.15-durable-forget.js](../../../scripts/test-v8.15-durable-forget.js) |
| B-MEM-03 | 合法Presence/直接观察/Disclosure | [test-v8.14.1-opening-presence.js](../../../scripts/test-v8.14.1-opening-presence.js)、[test-v8.15.1-disclosure.js](../../../scripts/test-v8.15.1-disclosure.js) |
| B-MEM-04 | Narrative provenance及事件/获知时间 | [test-v8.15.2-derived-acquisition-independent-qa.js](../../../scripts/test-v8.15.2-derived-acquisition-independent-qa.js) |
| B-MEM-05 | Legacy保守读取与迁移 | [test-v8.15-legacy-recall.js](../../../scripts/test-v8.15-legacy-recall.js) |
| B-WORLD-01 | Current Truth与时点历史边界 | [test-v8.15.2-world-memory-scope-audit.js](../../../scripts/test-v8.15.2-world-memory-scope-audit.js) |
| B-ACT-01 | FIFO/ACK/CONFIRMED及STALLED不重放 | [test-v7.10-rc6-rev3-run-command-recovery.js](../../../scripts/test-v7.10-rc6-rev3-run-command-recovery.js)、[test-v8.8.4-incident-regression.js](../../../scripts/test-v8.8.4-incident-regression.js) |
| B-LETTER-01 | LOAD/DATE及收信一次归档 | [test-v8.15.2-letter-receipt-startup-recovery.js](../../../scripts/test-v8.15.2-letter-receipt-startup-recovery.js)、[test-v8.15.2-outbound-bridge.js](../../../scripts/test-v8.15.2-outbound-bridge.js) |
| B-PROMPT-01 | Provider不使用越权或被忘记忆 | [test-v8.15.1-recall-ui.js](../../../scripts/test-v8.15.1-recall-ui.js)、[test-v8.15.1-disclosure.js](../../../scripts/test-v8.15.1-disclosure.js) |
| B-UI-01 | 三主题/Memory页面与异步状态 | [test-v8.14-e-memory-ui.js](../../../scripts/test-v8.14-e-memory-ui.js)、[test-v8.15.2-ui-races.js](../../../scripts/test-v8.15.2-ui-races.js) |
| B-PERF-01 | 默认关闭/有界诊断/错误隔离 | [test-v9.0-performance-trace.js](../../../scripts/test-v9.0-performance-trace.js)、[test-v9.0-independent-qa.js](../../../scripts/test-v9.0-independent-qa.js) |
| B-MOD-01 | 独立兼容非生产必需/保留Bridge | [test-v9.0-independent-qa.js](../../../scripts/test-v9.0-independent-qa.js) |

CK3/Provider/打包结果分别登记，不把Node夹具当作游戏效果确认。测试映射代表可执行入口，不声称覆盖所有将来工况；B-MOD的有/无Three-Mod真实CK3导出仍待实机，独立工程三组官职QA不再进入VOTC Release。
