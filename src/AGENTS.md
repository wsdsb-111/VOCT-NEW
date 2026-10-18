<<<<<<< Updated upstream
> 当前候选为 V9.3.7，沿用 V9.3.6 玩家中心记忆合同。当前版本及后续收口报告由根 README.md 和 docs/README.md 索引；V9.3.6.3 旧档兼容合同继续有效。otherParent 不扩大 Memory 权限，未验证的日历年龄仅作诊断。CK3／Provider／Soak／远端 CI 分开签署，远端失败不得写成未执行或 PASS。
=======
V9.3.9.1 当前修复补充（优先于下方 V9.3.9 历史状态）：只管理当前对话的定向人物披露；公开发言逐一记录给实际在场听众，私语仅指定人物，候场／缺席不继承。外貌身体沿现有白名单，称号公开；当前可靠公开父母子女及亲兄弟姐妹（含公开半亲）可免披露互知特质，未暴露私生亲属关系不适用。撤下 Worldline 认知服务生产接线，不扫描全体人物；保留原生定向 knownSecrets、手动状态与发送前复核，不恢复 Memory4。V9.3.9 摘要召回／冻结／预算及关系来源实现保持。年龄只移除稳定资料中过期年龄，原实机 +1 缺证据仍 NOT_CONFIRMED。当前报告为 docs/current/v9/V9_3_9_1_IMPLEMENTATION_REPORT.md。本轮按用户要求不连接 GitHub／远端 CI，不执行真实 CK3／付费 Provider／Soak／Release；下方 GitHub 上传说明只属于历史批次。

V9.3.9 补充合同：2／3 人时间摘要 5 篇、4+ 人 3 篇，第三人始终全场共享 3 篇；完整动态摘要成功注入并完成请求后按回应者冻结到稳定前缀，跨场不继承、不扩大来源权限。Character Knowledge 独立于退役 Memory4，按 Campaign／Owner／Target／fact／来源修订隔离并在发送前复核。用户本轮只交付代码、自动化验证和 GitHub 上传，不执行真实 CK3／付费 Provider／Soak 或 GitHub Release。
>>>>>>> Stashed changes

# Source Guidelines for the V9.3.7 Candidate

`src/app/` is the editable runtime source. `scripts/build-runtime.js` maps Main, Preload and Renderer to `resources/app/out` and default assets/package metadata to `resources/app`. Edit source first; generated resources are kept for direct VOTC.exe use and existing contract tests, then verified against the build.

Preserve JavaScript structure, Prompt bytes, cache IDs, IPC keys and the existing protocol 3.0/storage 2.5 contracts. The V9.3.7 candidate presents historical conversation memory as `Legacy Summary`; do not reintroduce Memory4/Durable production extraction, recovery, recall or writes, Sidecar reads/writes, Year/Life generation or background rebuilds. Pair important-matter indexing uses the shared `src/app/shared/pair-important-matters.js` parser; Renderer code must call `VOTCPairImportantMatters.parseImportantMatters()` when available and return no parsed rows when the global is absent, rather than copy parser rules. Keep Legacy data in existing summary files and index transactions. Candidate implementation, verification and index/source contracts are linked from `docs/current/v9/V9_3_7_IMPLEMENTATION_REPORT.md`, `docs/current/v9/V9_3_7_VERIFICATION_REPORT.md` and `docs/current/v9/V9_3_5_INDEX_AND_SOURCE_CONTRACT.md`; V9.3.4 reports remain historical evidence.

All payload files are listed in `build/runtime-inputs.json`. Add deliberate source files there using the existing mapping; report the final mapping from actual build evidence rather than hardcoding an unsettled count here. No secrets, user profiles, saves, logs, summaries, untracked local artifacts or Three-Mod code may enter source or build outputs. Source bytes are preserved by `.gitattributes`; do not normalize Prompt content.

Build tools use Node built-ins only. Runtime dependencies remain vendored in `resources/app/node_modules`, checked by `build/runtime-dependencies.lock.json`; do not install, upgrade or rebuild native dependencies as part of a source build. The existing Electron shell is reused, not rebuilt from Electron source.

V9.3.7 age and kinship facts require source-bound CK3 evidence. Calendar-only ages remain diagnostics; UNKNOWN must not become absence. Public otherParent and current step-family facts never grant Memory access. Current step-family requires fresh current marriage and complete public parents; reject explicit death, life conflicts, secret or ambiguous evidence. Historical Legacy facts retain their original authorization; do not infer historical step-family from former spouses. New exporter fields require a fresh CK3 export.
