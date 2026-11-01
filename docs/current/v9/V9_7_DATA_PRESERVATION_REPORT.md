# V9.7 数据保留报告

本轮没有访问、复制、迁移、删除或重写生产 APPDATA、CK3 存档、真实摘要/记忆/配置/凭据。没有改 Steam Workshop 或独立多 Mod 兼容项目。只读/恢复测试使用合成数据，临时目录用受控前缀和父目录检查后清理。

新增 `test-v9.7-legacy-data-readonly.js` 用 MemoryStore 的真实兼容 reader/Pair preview：准备手改摘要、旧无 Campaign 摘要、错误 owner、专用官方记录及来源绑定 Forget；显式 Forget 操作完成后冻结全文件 SHA。普通读取、Pair readOnly/preview 和重新构造 Store 后，10 个文件路径及哈希相同；手改正文逐字保留，旧正文能读，Forget 不复活，错误 owner/官方专用记录不混入。Pair preview 不创建派生索引。

测试中的 archiveSidecar 哨兵放在 MemoryStore baseDir 的对应目录；其余 retained 哨兵是额外不应被碰触的字节，不是可供相应 reader 解析的有效队列/Canon 格式。哈希检查不代表已验证这些业务恢复。第一次构造和显式 Forget 在快照前，不声称第一次启动零写；源码/现行完整回归负责既有构造及 journal 恢复合同。

Canon、ACK、未收信件、Finalization、恢复和旧配置均继续依赖现有各自合成夹具及完整发布组，映射见 [行为矩阵](V9_7_BEHAVIOR_PARITY_MATRIX.md)。不新造第二套 schema/migration，不把保留文件数量当作恢复成功证据。

本地 `.build/v97-baseline/` 只保存受控构建文件和匿名回执指纹。V9.7 构建仅输出 `.build/runtime`，不替换用户正在使用的安装；原已安装 V9.6.1 353 文件继续保留，报告不再称它与新源码同版本。未来如需安装，应先保存对话/退出应用，再单独授权现有事务部署；无需迁移记忆或清空设置。

回滚 D01/版本标签用 Git 逆向提交并重新构建；由于本轮没有真实数据迁移，不存在要重放的用户数据事务。禁止恢复整份旧用户目录覆盖后来的新写入。
