# V9.3.3.1 实际改动清单

基线 `fc4f1c60a13b06d7daddac697e484db335f26647`；详细根因见[实施报告](V9_3_3_1_FIX_REPORT.md)，验证边界见[验证报告](V9_3_3_1_VERIFICATION_REPORT.md)。最终逐文件清单由工作区差异核对后列于下方。

| 范围 | 改动与必要性 |
|---|---|
| `.gitattributes` | FIX-01：受管二进制默认 -text，清除 eol；明确文本类型仍 CRLF。保留用户规格原文尾部空格 |
| `src/app/main/memory-system/memory4-coverage.js` | FIX-02：summary/fact 局部谱系、相同 provenance 身份和当前 fact/hash；拒绝身份冲突 |
| `src/app/renderer/memory4-manager.js` | FIX-03/04：当前页 offset、缓存来源再认证/失效、请求 token、成功导航先释放 Loading |
| `src/app/main/app/app-updater.js` | 四段版本的必要启动兼容：遵守既有禁用 policy，不实例化 updater SDK |
| `package.json`、`src/app/package.json`、`src/app/main/version.js`、Renderer index/版本常量、`ui-theme-preview.html` | 仅同步 Core/App/UI 9.3.3.1 |
| `resources/app/package.json` 与受影响 out 文件 | 按 build/deploy 生成，逐项核验 parity，没有单独改 out 或整体重打包 |
| `scripts/test-v9.3.3.1-binary-checkout.js` | 新发布组：Git 原生 Windows filter/资产 bytes、文本类型及 LFS 合同 |
| `scripts/test-v9.3.3.1-coverage-interactions.js` | 新发布组：生产 React 事件级 95 facts、20 项分页/导航/竞争/STALE/认证失败用例 |
| `scripts/test-v9.3.3-independent-qa.js` | 独立敌对 fixture、同页污染/重复来源/冲突身份，移除直接写入绕过，真实 writer 12/12 |
| `scripts/test-v9.3.3-memory4-coverage-ui.js` | 合法 fixture 返回当前真实 fact；更新请求 token 的静态 guard 预期，保留原安全回归 |
| `scripts/test-manifest.js` | 两个新发布组登记，实际 517 test 文件/443 release 组/73 archive |
| 原版本合同及出站黄金测试 | 更新明确版本预期，保留字节/哈希/scope 断言；updater isolation 增加真实 SDK 反例 |
| README、CHANGELOG、docs 索引/准则、源码准则 | 当前版本、交付链接与待推送 CI 状态；旧报告与协议版本不改 |
| 本轮规格/报告/匿名证据 | 原文、四项先红后绿、资产 hash 和实际验证结果，不含用户记忆/配置/日志正文 |

本轮不改 `.github/workflows/regression.yml`、build/deploy/verify 的安全实现、runtime-inputs/dependency lock、二进制资产 blob、Durable Planner/Policy/8 条上限、Store/Recovery、Provider/GLM/Action、Prompt/cache anchor、IPC 名称/ACL/正文读取合同、Workshop 或 Three-Mod。

本地 `.build` 的下载工具、隔离快照、临时测试、部署回执及日志不提交。两组打包 smoke profile/截图只含匿名合成数据，保留在本地临时目录。没有用户数据迁移、Year/Life apply、真实 Provider 请求或自动推送。

## 逐文件核对

共 42 个路径；与基线逐项核对，binary assets 没有 bytes 改动。

- `.gitattributes`
- `AGENTS.md`
- `CHANGELOG.md`
- `README.md`
- `docs/AGENTS.md`
- `docs/README.md`
- `docs/current/v9/V9_3_3_1_CHANGED_FILES.md`
- `docs/current/v9/V9_3_3_1_FIX_REPORT.md`
- `docs/current/v9/V9_3_3_1_FIX_SPEC.md`
- `docs/current/v9/V9_3_3_1_VERIFICATION_REPORT.md`
- `docs/current/v9/v9331-verification-evidence.json`
- `package.json`
- `resources/app/out/main/AGENTS.md`
- `resources/app/out/main/app/app-updater.js`
- `resources/app/out/main/memory-system/memory4-coverage.js`
- `resources/app/out/main/version.js`
- `resources/app/out/renderer/assets/index-Dn3qWlAB.js`
- `resources/app/out/renderer/index.html`
- `resources/app/out/renderer/memory4-manager.js`
- `resources/app/package.json`
- `scripts/AGENTS.md`
- `scripts/test-manifest.js`
- `scripts/test-v7.7.4-stability-infrastructure.js`
- `scripts/test-v7.8-main-modularization.js`
- `scripts/test-v7.9-updater-isolation.js`
- `scripts/test-v8.14.1-frontend-content.js`
- `scripts/test-v9.2.3-glm-outbound-equivalence.js`
- `scripts/test-v9.3-adapter-conformance.js`
- `scripts/test-v9.3.3-independent-qa.js`
- `scripts/test-v9.3.3-memory4-coverage-ui.js`
- `scripts/test-v9.3.3.1-binary-checkout.js`
- `scripts/test-v9.3.3.1-coverage-interactions.js`
- `src/AGENTS.md`
- `src/app/main/AGENTS.md`
- `src/app/main/app/app-updater.js`
- `src/app/main/memory-system/memory4-coverage.js`
- `src/app/main/version.js`
- `src/app/package.json`
- `src/app/renderer/assets/index-Dn3qWlAB.js`
- `src/app/renderer/index.html`
- `src/app/renderer/memory4-manager.js`
- `ui-theme-preview.html`
