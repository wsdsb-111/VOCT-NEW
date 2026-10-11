# V9 退役台账

日期：2026-10-11。没有引用与恢复证据的内容统一 KEEP_UNTIL_PROVEN。

| legacyPath | owner／当前调用者 | replacement／reader | 数据风险、测试和回滚 | 状态／最早阶段 |
| --- | --- | --- | --- | --- |
| Three-Mod源及三QA | 独立兼容；仅自身QA与manifest引用 | 独立repo mod/tests/CI | 完整复制/hash/独立3绿后移除13源、3QA、3release登记；回滚冻结archive；不动已安装Mod | LOCAL_PASS，V9.0 |
| tianjia-benji-repair | 上游天家手工决策补丁；无VOTC生产引用 | 独立repo patches/可选归档 | README＋两原件逐字节保留并核验后移除旧副本；无游戏内验收；不自动部署 | 审计与归档LOCAL_PASS，V9.0 |
| v8.15.2-letter-runner | VOTC正式DATE/RunFile/ACK桥 | V9.6 ck3-mod正式源规划 | 删除会断游戏通信；保留后台投递/LOAD去重测试 | KEEP至V9.6+验证 |
| action-system历史目录／旧AE测试 | 历史AE，正式路径Official2.0.3 | 官方动作服务；历史归档reader | 不重新接入生产；先查全引用再移除，保留历史证据 | KEEP_UNTIL_PROVEN，V9.8 |
| Legacy摘要／episodes／recovery | Memory4与终局仍消费 | 兼容reader继续有效 | 玩家数据／授权／遗忘；无清理实验，永久反例保护 | KEEP_UNTIL_PROVEN，V9.2/9.8 |
| 旧Prompt block ID／Provider特判 | PromptBuilder与厂商serializer | V9.3/9.4接口规划 | Cache锚点和源权限是兼容合同，不在V9.0重排 | KEEP_UNTIL_PROVEN |
| 打包out与Renderer assets | 当前唯一实际生产入口 | V9.1正式源／build规划 | 不能当生成垃圾删除，冻结zip/LFS保持 | KEEP至构建行为等价 |
| V6—V8历史文档 | 历史事实与回滚索引 | 新V9入口链接旧报告 | 保留真实当时结果与链接，不重写旧PASS | 永久归档 |

施工状态与回滚索引由[验证报告](V9_0_VERIFICATION_REPORT.md)更新；任何退役不删除运行时Memory、Forget、信件、日志或存档。
