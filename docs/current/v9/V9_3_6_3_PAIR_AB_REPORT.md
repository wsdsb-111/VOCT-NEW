# V9.3.6.3 综合候选 Pair A/B

状态：PASS；仅合成检索基准，不是端到端 CK3 或模型验证。

冻结运行 payload `8a706fd7ab2cfb507c0f8ae52c437758c3fb42c98d950febcf56862b57e82a10`，289 项映射；Node v22.23.3，AMD Ryzen 7 7840H  w/ Radeon 780M Graphics     ，Windows 10.0.26200。源码与测试输入逐文件哈希在[源码证据](v9363i-source-evidence.json)，采样前后保持一致。sourceHead记录未提交工作树的施工起点，不代表候选字节；本轮由sourceHashes和payload锁定，最终代码提交见综合验证报告。

A 为同版本 exhaustive-reference；B 为同版本 safe-candidate-directory。每格 A 1 次 cold、B 1 次 cold 和 20 次连续 warm，无额外预热。Cold 是进程内引擎/索引空缓存，不是磁盘冷启动；夹具准备和 MemoryStore 初次加载在计时外。统计仅覆盖 retrievePairMemorySources，不含完整 Prompt、Provider 和游戏等待。

共 22 格、484 次调用；全部语义/来源/顺序/权限/窗口/预算对照与预设性能门槛通过。100/300 Pair 普通及1199年/去年窗口、300 Pair 的1/5/10个不确定范围，以及 allmention/unscoped unknown 均保留。后两类最坏路径单列，不套常规延迟门槛；表中PASS表示其正确性和预期回退通过。A/B单次cold均不提供可信P95。

| 场景 | A cold ms | B cold ms | B warm P50 / P95 ms | B真实索引Read | B不同Scope数 | 门禁 |
|---|---:|---:|---:|---:|---:|---|
| n100-normal-L1 | 876.4 | 181.8 | 176.5 / 184.8 | 2 | 1 | PASS |
| n100-normal-L2 | 805.9 | 192.9 | 190.8 / 206.6 | 2 | 1 | PASS |
| n100-explicit-1199-L1 | 824.0 | 186.2 | 170.4 / 182.2 | 2 | 1 | PASS |
| n100-explicit-1199-L2 | 798.8 | 176.6 | 183.0 / 210.9 | 2 | 1 | PASS |
| n100-previous-year-L1 | 795.0 | 162.2 | 170.4 / 178.6 | 2 | 1 | PASS |
| n100-previous-year-L2 | 977.1 | 175.9 | 184.2 / 197.1 | 2 | 1 | PASS |
| n300-normal-L1 | 2475.5 | 503.4 | 496.2 / 513.0 | 2 | 1 | PASS |
| n300-normal-L2 | 2592.8 | 524.8 | 504.0 / 531.3 | 2 | 1 | PASS |
| n300-explicit-1199-L1 | 2474.6 | 540.1 | 560.3 / 609.9 | 2 | 1 | PASS |
| n300-explicit-1199-L2 | 2554.9 | 540.6 | 526.3 / 549.2 | 2 | 1 | PASS |
| n300-previous-year-L1 | 2729.4 | 515.2 | 495.7 / 519.7 | 2 | 1 | PASS |
| n300-previous-year-L2 | 2595.5 | 502.0 | 498.3 / 526.4 | 2 | 1 | PASS |
| n300-old-u1-L1 | 2528.3 | 517.3 | 495.7 / 522.1 | 4 | 2 | PASS |
| n300-old-u1-L2 | 2356.9 | 490.6 | 514.2 / 570.6 | 4 | 2 | PASS |
| n300-old-u5-L1 | 2427.3 | 525.5 | 523.7 / 539.2 | 12 | 6 | PASS |
| n300-old-u5-L2 | 2384.7 | 533.8 | 524.0 / 573.5 | 12 | 6 | PASS |
| n300-old-u10-L1 | 2359.6 | 543.8 | 546.7 / 579.6 | 22 | 11 | PASS |
| n300-old-u10-L2 | 2542.1 | 671.9 | 580.0 / 627.6 | 22 | 11 | PASS |
| n300-allmention-L1 | 2421.6 | 2678.4 | 2089.3 / 2271.5 | 600 | 300 | PASS |
| n300-allmention-L2 | 2507.7 | 2639.6 | 2065.4 / 2111.4 | 600 | 300 | PASS |
| n300-unscopedunknown-L1 | 2611.2 | 2604.2 | 2034.5 / 2162.1 | 600 | 300 | PASS |
| n300-unscopedunknown-L2 | 2454.5 | 2570.5 | 2040.0 / 2247.6 | 600 | 300 | PASS |

L1原文Resolve为0，L2整个来源链Resolve尝试至多2；候选数不冒充实际Read。所有匿名逐次样本与计数见[原始证据](v9363i-integrated-ab-evidence.json)，SHA-256 `9b4c5bc91f92a86cf83c4dd4713d8094c30707511b7d4f8057f4bd9ea98c6558`。本轮预修复基线另有310次离线采样；前一TwoP1批次的9116次保持历史证据，不计入本轮484次。
