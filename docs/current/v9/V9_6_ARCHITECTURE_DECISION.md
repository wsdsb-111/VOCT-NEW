# V9.6 探索架构决策：同仓可审计，交付统一，工件解耦

日期：2026-10-24。状态：**探索推荐，非迁移／发布批准**。用户将统一交付作为9.6目标；本轮不实现安装器、自动更新或Workshop发布。

## 决策与依据

建议正式施工优先采用同仓的`src/app/`与拟建`ck3-mod/`两套权威源、各自构建清单和版本，协议合同集中登记。发布阶段再组装一个Workshop交付包；两套运行域保持现有日志／文件边界。源码同仓不等于两个版本必须同时增加，也不等于将Electron运行在CK3脚本引擎中。

| 选择 | 判断 |
| --- | --- |
| A 同仓完整Mod源＋独立工件 | 推荐候选；可同次审查跨端Effect／事件／parser，CI取得同一基线，适合当前已有本fork热修的情况 |
| B 独立Mod仓库固定commit引用 | 保留备选；若明确由另一维护团队负责，固定commit与哈希同样可行，需要跨仓协调 |
| C Workshop安装目录＋局部补丁长期作源 | 只适合当前取证；Steam更新会覆盖安装目录，无法由干净checkout重建完整Mod，不作长期方案 |

A的前置条件：确认本fork未来权威源及维护职责；逐项评审当前快照相对固定上游的19项规范化文本差异和5项新增，另做语义及归属核对；保留许可及改动说明。不能宣称本轮已纳管完整Mod，不能直接用上游2.0.4覆盖现有2.0.5。

## 一次下载与独立更新如何同时实现

候选包可分为Mod payload、带版本的Windows Runtime payload及小型启动入口／清单。玩家订阅获得必要字节，首次运行随包入口；开发者仍可在GitHub维护源码，但玩家正常安装不依赖手动访问GitHub。

优先研究：从Workshop只读payload向**独立、可写、按版本保存的Runtime目录**进行验证与激活，再启动现有VOTC进程。不要让运行中的EXE／DLL直接依赖Steam可覆盖的安装路径。个人设置、API凭据、Legacy、信件及RunFile队列继续留在现有userData；升级或回滚不删除、不盲目迁移这些状态。

Runtime payload必须来自干净的受校验发行构建，不把当前开发目录整体压入Workshop；排除`.git`、`.build`、测试profile、日志、真实存档和个人数据。游戏脚本与Electron资源分别做输入／产物清单，合并发行时只引用可分发工件。

必须分别解决：订阅下载、首次启动、已运行进程更新、游戏中Mod更新后激活、回滚。Steam文档说明Workshop安装／更新由Steam客户端处理，且新订阅可能在游戏启动后仍在后台下载；[官方安装规则](https://partner.steamgames.com/doc/features/workshop/implementation#Item_Installation)并未授予当前CK3 Mod自动启动任意外部程序的能力。**文件到达不等于程序启动**，不承诺“订阅后自动运行”。

当前本fork自动更新已关闭，且已有单实例锁。新入口首先处理已有进程与安全退出／延迟激活，不能绕过部署保护、自动重启正在生成的对话，或启动第二个Runtime。新版本与旧版本不能同时争用同一`debug.log`／剪贴板／RunFile队列。

## 更新矩阵与回滚原则

| 更新 | 应保持的隔离 |
| --- | --- |
| 仅App的UI、Provider或内部算法 | Mod哈希和wire contract不变；不覆盖游戏源或存档变量 |
| 仅Mod场景／原生GUI | App保持不动；涉及导出、脚本函数、事件或全局变量时仍需合同测试 |
| 修改导出／ACK／Receipt语义 | 协议major或相应contract升级，保留支持旧格式的适配范围；不靠相同版号假定兼容 |
| Steam更新而游戏／App仍运行 | staging与当前active分开；先保留旧进程，下一安全启动校验本场Mod声明及工件组合 |
| App回滚 | 先检查持久数据可读范围；队列写出／ACK证据保留，未知Effect不重放。旧二进制不能在不理解新状态文件时直接写入 |

“互不受更新干扰”限定为已声明支持的合同内组合；任意破坏性变更、CK3引擎升级和第三方覆盖都无法无限保证。独立版本＋明确支持范围＋跨版本fixtures，才是可验证的目标。

## 发布前仍需证明的事实

- Workshop项3346777360的实际发布维护权限，或本fork采用的新item；descriptor的remote_file_id不证明账户权限。
- CK3／Paradox对于随Mod分发Windows可执行payload的具体规则、扫描与首启体验。只查阅通用[Steam Workshop实现文档](https://partner.steamgames.com/doc/features/workshop/implementation)，未获得CK3特定发布批准，不推断“必定允许”或“必定禁止”。
- Mod README／LICENSE声明CC BY-SA 4.0，Runtime包声明GPL-3.0-only；各组件保留独立许可、署名与改动记录，另审Electron／native依赖及素材。参见[上游](https://github.com/Voices-of-the-Court/votc_mod/tree/0cf4845a69f9e8633333ca04e558afe8216490f2)、[CC条款](https://creativecommons.org/licenses/by-sa/4.0/)。不将本报告当成重许可或发布批准。
- Workshop体积、杀毒／SmartScreen、安装路径权限、Windows文件锁、离线首启和回滚空间。当前Mod约13MB，完整Runtime分发远大于Mod；本轮不以未测量值设平台结论。
- Mod源构建与Runtime构建应各自有manifest，再由release manifest引用两份哈希；不要直接把全部Mod文件塞入目前仅接受Runtime源的`build/runtime-inputs.json`。

若平台或首启验证不通过，应如实记录统一Workshop交付尚不可用。只在Workshop放一个要求玩家去GitHub找程序的链接，不能算达到用户的一次下载目标。
