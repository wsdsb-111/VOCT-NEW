# V9.6 源码清单与来源取证

日期：2026-10-24。证据为源码／磁盘只读快照，非CK3运行结果。

## 当前副本的角色

| 副本 | 当前用途与权威边界 |
| --- | --- |
| `src/app/`，基线060e336 | VOTC Runtime权威构建源；`build/runtime-inputs.json`映射346项，`resources/app`为生成运行资源 |
| Workshop `1158310/3346777360` | 当前实际安装、包含本地修复的完整Mod快照；无Git历史，不能由目录名证明Steam最新版本或修改归属 |
| `compatibility-patches/v8.15.2-letter-runner` | 七个本fork游戏侧热修快照，非完整Mod工程；以后需归入完整Mod的唯一权威源，避免双源漂移 |
| 公开上游 `Voices-of-the-Court/votc_mod` | README指向的来源参考；本轮固定到 `0cf4845a69f9e8633333ca04e558afe8216490f2`，不使用浮动master作发布输入 |
| 独立多Mod兼容工程 | 不属于本次自身Mod源码纳管或统一分发范围 |

## 安装快照

绝对位置：`D:\SteamLibrary\steamapps\workshop\content\1158310\3346777360`。

- 97文件，12,995,956字节；9 DDS、20 GUI、37 TXT、27 YML、2 Markdown、1 descriptor、1 PNG。
- `descriptor.mod`：`version="2.0.5"`、`name="Voices of the Court 2.0"`、`supported_version="1.20.*"`、`remote_file_id="3346777360"`。
- 该descriptor未声明`dependencies`、`replace_path`或程序启动项。这不代表加载顺序中不存在同文件／同符号覆盖。
- 树指纹：`cf872f6a6d79878dc6106e312919b78f641971dda026bc3cdb1c5c926f040756`。
- [逐文件路径、字节数、SHA-256及上游比较](v96-workshop-source-inventory.json)。树哈希算法写在JSON；采集前后复核文件树及每个文件字节，采集期间未变化。不跟随符号链接。

目录包含活动、角色互动、事件、scripted effects/guis、日期载入钩子、场景与原生头像GUI、图形资源及九组语言文件。没有EXE、Electron资源或Runtime启动器；当前订阅内容自身不能提供本fork桌面程序。

## 仓库补丁与安装副本

下列七文件的原始SHA-256均相同，完整值见JSON：

| 相对Mod根目录的路径 | 字节比较 |
| --- | --- |
| `common/on_action/votc_load_boundary.txt` | SAME |
| `common/scripted_guis/votc_runtime_clock.txt` | SAME |
| `gui/custom_gui/votc_runtime_bridge.gui` | SAME |
| `gui/custom_gui/letters_runner.gui` | SAME |
| `gui/event_window_widgets/event_window_widget_message_clear.gui` | SAME |
| `gui/event_windows/votc_invisible_event.gui` | SAME |
| `gui/scripted_widgets/votc_runtime_bridge.txt` | SAME |

## 固定上游差异

公开仓库及其README／许可已核对：[上游源码](https://github.com/Voices-of-the-Court/votc_mod/tree/0cf4845a69f9e8633333ca04e558afe8216490f2)。固定快照95文件、descriptor 2.0.4；本轮只把归档下载到`.build`做内存比较，没有安装或覆盖任何文件。

| 比较类型 | 数量 | 解释 |
| --- | ---: | --- |
| 同路径且原始字节相同 | 10 | Git blob SHA-1与归档SHA-256交叉核对 |
| 同路径原始字节不同 | 82 | 其中63项忽略UTF-8 BOM及CRLF/LF后相同，19项文本仍不同 |
| 仅本机 | 5 | 载入边界、原生日期GUI、全局Bridge GUI及注册、campaign identity effect |
| 仅上游 | 3 | `.gitattributes`、`.gitignore`、`.github/workflows/release.yml`，属于仓库管理文件 |

19项规范化文本差异包括四个资料导出effect、descriptor、信件事件、含旧runner在内的四个GUI、九份人物本地化文件。此处只证明去除BOM／换行后文本仍不同，未逐段判定语义；不能把全部82项都称为功能改动，也不能因规范化相同就改写其原始字节。具体来源／作者与修改说明待完整纳管时逐项追认；目前不指定某个浮动上游为本fork权威源。

## 归属与覆盖风险

安装README声明Mod为Durond与MrAndroPC的CC BY-SA 4.0作品；`LICENSE.MD`存在，Runtime包元数据声明GPL-3.0-only。前者的署名、改动说明和相同许可要求应保留，参见[许可原文入口](https://creativecommons.org/licenses/by-sa/4.0/)。本报告仅记录声明，不把混合打包视为统一改许可的授权，也未逐项确认图形资产来源或Workshop账户权限。

潜在覆盖点：Mod相对文件路径、`mcc_event_v2`／`message_event`事件ID、`log_income`等通用effect名、`mcc_characters_list_v2`等全局符号、GUI名和本地化key。没有扫描全部其他Workshop项或读取当前播放集，不能出具“与其他Mod无冲突”的结论。

正式导入建议：先把当前快照、上游固定提交与19项规范化文本差异／5项本地新增分开评审，再确定`ck3-mod/`为本fork唯一源；Workshop安装路径只作部署目标，不作为未来开发权威源。本轮未进行此导入。
