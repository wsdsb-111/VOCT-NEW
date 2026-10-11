# 独立兼容工程迁移

日期：2026-10-11；本地迁移 LOCAL_PASS，远端 CI／游戏验证另列。

独立远端由用户创建：[CK3-Three-Mod-Compatibility](https://github.com/wsdsb-111/CK3-Three-Mod-Compatibility)。本轮不上传或push。独立工作目录为 `C:/Users/97330/Documents/Codex/CK3-Three-Mod-Compatibility`，安装目录仍是 `E:/Documents/Paradox Interactive/Crusader Kings III/mod/VOTC_Three_Mod_Character_Name_Compatibility`，两者含义不同。新工程已初始化main和指定origin，尚无commit。

迁移交易：冻结13个Mod与三个仅builtin依赖QA → 独立mod/tests/docs/CI完整复制 → manifest源/目标hash → 全新独立副本三组测试与缺文件负例 → 从VOTC工作树移除相应副本和三个release项 → VOTC全门禁与无必需依赖检查。历史V8报告保留，通过独立repo外链查功能源；不重写Git历史。

`tianjia-benji-repair`只含README和两个手工CK3补丁，无resources/scripts生产调用，按可选上游补丁复制至独立patches；不是Three-Mod1.0.6自动安装内容。`v8.15.2-letter-runner`是VOTC DATE/RunFile/ACK正式桥，留在原位，不与兼容工程迁走。

新repo的版本仍1.0.6，本轮不改官职或称谓效果，不改已安装Mod、Playset、原三上游Mod。独立CI与CK3验证分别为CI_PENDING/CK3_PENDING；最终复制/hash与本体移除结果在[验证报告](V9_0_VERIFICATION_REPORT.md)登记。

已完成：13个Mod文件原样复制、3个QA只替换modRoot、3个可选天家补丁原样归档；清单19项源/目标SHA逐项通过，独立QA另从冻结Git blob／CRLF checkout复核。独立临时干净副本 `node tests/run-tests.js` 3/3通过；移除必需office脚本的副本按预期ENOENT／exit1。随后从VOTC当前工作树移除19个源文件及三项release登记，resources/scripts/workflow无兼容源必需引用。历史V8路径和测试命令保留为当时记录；当前命令在独立工程运行，不能照旧在VOTC执行。

独立工程的 `migration-manifest.json`、`docs/migration-from-votc.md` 与 `THIRD_PARTY_NOTICES.md` 保存源SHA、变换、退役和许可来源；没有擅自创建许可证。VOTC用户数据3536个既有文件、Workshop Bridge7文件、安装Mod13文件在施工后重新核对冻结SHA一致，见[保留核验](preservation-verification.json)。
