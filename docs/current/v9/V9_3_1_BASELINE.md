# V9.3.1 修复施工基线

本轮基线为 `6e232091edb109ccc1e34d26c4b9a120b8a199ba`，施工前工作树干净。用户要求按下载文档进行修复；[归档方案](V9_3_1_IMPLEMENTATION_SPEC.md)仅去除Markdown行尾空格，原始SHA-256 `a8240fa971b9d94e51b4f279b33b4aab6c5e1c98153475947c0da70bc7fe055b`。文档中的示意代码、状态和待验收项均需以源码与实际测试核对，不当成已完成事实。

正式Core/UI V9.2、App9.2.0、Mod2.0.5、Memory4.0／协议3.0／存储2.5保留。只修Gemini原生用量及Action失败诊断；GLM缓存继续HOLD→V9.4。默认新增真实API调用0，不读取凭据、真实存档、摘要或APPDATA，不写真实Effect。

基线源码／部署映射293项，`verify-runtime-build.js --deployed` PASS。586份源码／生成资源已逐字节保存在忽略的 `.build/v931-baseline`，inventory SHA-256 `23d24f166b063c78dd6fd145118c212a29e47a114331834b0988783c6367e0ea`；没有复制用户运行数据。既有39个匿名Golden文件SHA-256 `5553f48da7f5747420ecffe16b4e12429e63cd4b167429090167f3324b384ff3`，正常出站重放通过；冻结文件不改写。

基线[Release Regression #118](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/38350638449)已通过GitHub公开API核验：head_sha完全等于本轮基线，completed/success，更新时间2026-10-13T05:24:40Z。它只证明旧V9.3提交；V9.3.1最终SHA CI另列待验收，用户自行推送，不自动上传。

新增Gemini、Action和独立QA测试先在基线执行RED，合成数据不联网。Gemini15组中11 RED／4 PASS，Action最终36个RED断言，独立QA9组中8 RED／1 PASS；新增3个发布组，507 test文件／435 release组／71历史组。原始日志保留在 `.build/v931-gemini-RED.log`、`.build/v931-action-RED.log`、`.build/v931-independent-RED.log`；初始Action24个RED另存 `.build/v931-action-initial-RED.log`，不以改写RED掩盖失败。

本地基线、CI及Golden哈希见[匿名基线证据](v931-baseline-evidence.json)。CK3、Soak和Gemini真实端点均未在本轮验证，修复候选不得自动称FULL_FREEZE。
