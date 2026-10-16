# V9.3.6.1 跨 Pair 检索基准

结论：本版按 FIX-03 允许的降级路径交付测量与运行诊断，逆索引／额外候选缓存延期，未宣称性能优化完成。保持完整 Owner 合法候选扫描，无任意 Top-N，不牺牲跨 Pair 转述。

命令：node scripts/test-v9.3.6.1-pair-retrieval-scale.js --benchmark。原始匿名合成结果见[证据](v9361-pair-scale-evidence.json)。本次性能运行环境为 Windows x64／Node v24.13.0，与发布门禁 Node22.23.3 分开记录。数据只含人工合成 Pair、Legacy、Forget 和索引，不读取真实 APPDATA、不调用网络。

| Pair 数 | cold/warm 样本数 | cold wall P50/P95 ms | warm wall P50/P95 ms | CPU P50 cold/warm ms | 显式索引逻辑调用 | source resolve |
|---|---|---|---|---|---|---|
| 5 | 4/8 | 61.6 / 70.5 | 45.5 / 58.5 | 62.0 / 47.0 | 10 | 0 |
| 30 | 4/8 | 698.9 / 869.1 | 743.9 / 873.2 | 703.0 / 735.0 | 60 | 0 |
| 100 | 2/3 | 6936.5 / 7229.7 | 6739.8 / 6795.0 | 6844.0 / 6657.0 | 200 | 0 |
| 300 | 1/3 | 53957.5 / 53957.5 | 41658.5 / 42389.4 | 53328.0 / 40672.0 | 600 | 0 |

cold 仅表示清除 PairLedger 内存 scope cache；未清除 Windows 文件缓存。warm 使用同一 Engine、snapshot 和 PairLedger cache；计时只包含 retrieval，不包含建库、seed 或加载 snapshot。逻辑读取是明确调用 PairLedger.read 的次数，包含最后修订复验，不是 OS 物理 I/O 统计；resolve 单独计数。

300 Pair cold 只有一个样本，因此 P50=P95，仅表示该次观察，不能作为可靠尾延迟。其余样本也较少，且同机有并发验证，结果不是稳定性能承诺。观察到 warm 的来源／Forget 复验仍产生明显开销；不能因为 cache 命中就跳过复验。

默认发布回归仅执行正确性与 5 Pair 轻量 smoke，不覆盖完整基准文件。7 项正确性检查覆盖 L0 零第三人读取、L1 零来源、L2 最多两次总尝试、转述保留、反向私有视角隔离、Campaign／Forget／编辑／删除失效；未改变算法，因此候选集与原逻辑相同。后续若引入 Owner→Target 逆索引，必须先证明完整性、失效和选中集合等价。

新增匿名诊断 candidatePairCount、actualIndexReadCount、indexCacheHits／Misses／Hit；只有所有明确索引调用都命中、且没有未知失败时 indexCacheHit 才为 true。既有 sourceResolveAttemptCount、indexLookupMs 和 fallback 状态继续保留；这些字段经过白名单投影持久化，不记录原文、人物姓名或文件路径。
