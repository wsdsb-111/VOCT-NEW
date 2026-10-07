# VOTC App 与 CK3 Workshop Mod 外部运行依赖

日期：2026-10-05。本文记录 V8.14.2 信件 Date Runner 的 App/Mod 发布依赖；这是外部运行依赖合同，不代表 CK3 实机 Gate 已通过。

## V8.15.2 Canonical Trait 输出补充（2026-10-07）

App 与 Workshop item `3346777360` 仍独立发布。V8.15.2 App 可读旧特质行，但稳定 canonical ID 需要 Mod 的 `common/scripted_effects/log_character_v2_effect.txt` 配套更新：角色、子女、兄弟姐妹三条 `VOTC:IN` 特质流在 category 字段前输出 `[THIS.Trait.GetKey]`。新解析保留 traitId、localizedName、category、name、desc，不改变其他字段。

本机该文件 SHA-256 为 `B567FFBEF3B7FF720630D9D9C60ACDB3FFF3AFAE4E883D38639FCC890CE10DE2`。这表示本次核查内容，不证明 Steam 已发布；仅更新 App 或对照 descriptor 版本不能保证补丁存在。独立打包 Mod 时须携带该文件并保留下方 Date Runner 链，Steam 覆盖后须重新复核。未修改 Three-Mod 兼容补丁。真实 trait key 输出与 L10-L15 验收见 [V8.15.2 报告](v8.15.2-implementation-report.md)，下方哈希表为前置日期补丁快照。

## 发布关系与依赖范围

VOTC App 与 Steam Workshop Mod 是独立发布物。本文所述的信件日期恢复依赖 CK3 加载并启用 Workshop item `3346777360`。App 不包含、复制或更新该 Mod，也没有 Mod 版本握手；仅更新 App 不能补上 CK3 读档后的日期 runner 自举入口。

V8.14.2 已核对的版本元数据如下。相同的 `2.0.4` 字符串来自两个独立文件，不构成 App 与 Mod 的联动发布证明。

| 来源 | 实际记录 | 含义 |
|---|---|---|
| 功能版本 | `V8.14.2`，见根目录 `CHANGELOG.md`，日期 `2026-10-05` | App 功能/修复基线 |
| App 包元数据 | `resources/app/package.json` 的 `version` 为 `2.0.4` | Electron 包版本，不是 V8 功能版本 |
| 当前工作区 `VOTC.exe` 元数据 | FileVersion `2.0.3`，ProductVersion `2.0.3.0` | 与 `package.json` 不同；EXE 元数据不是其加载的 `resources/app/out` 功能版本证明 |
| 本机 Workshop descriptor | item `3346777360`；`descriptor.mod` 声明 `version="2.0.4"`、`name="Voices of the Court 2.0"`、`supported_version="1.20.*"` | 本机 Steam 内容目录中的自述元数据，不证明其他用户已收到相同内容 |

因此，本合同不把 `2.0.4` 推导成未来兼容版本范围，也不写 `>=2.0.4`。当前可复核的依赖基线是 Workshop item ID、descriptor 字段及下表文件内容指纹的组合。其他 descriptor 版本或指纹都须重新核对；仅版本号较高不自动代表包含兼容的 Date Runner。

本机 VOTC.exe 加载当前打包资源的隔离窗口验收见[收口修复报告](v8.14.2-closeout-fix-implementation-report.md)，不据 EXE 旧元数据判定资源缺失；其他独立分发物仍须逐一核对实际资源与配套 Mod。

## Date Runner 合同

App 的运行时从 CK3 `debug.log` 读取日期/producer 标记，Worldline 服务识别 `VOTC:LOAD_SESSION`；日期恢复路径由 `LetterManager` 通过共享 RunFile 队列请求 `date_producer_rearm`。CK3 侧必须提供下列配套链路：

1. `common/on_action/votc_load_boundary.txt` 在 `on_game_start`（新开局与读档）递增 `votc_load_epoch`、写出 `VOTC:LOAD_SESSION`，并对每位玩家延迟一个游戏日触发 `mcc_event_v2.9998`。
2. `events/mcc_events_v2.txt` 中已有的 `.9998` 事件使用 `votc_invisible_event` 窗口。
3. `gui/event_windows/votc_invisible_event.gui` 在窗口结束时清理并重建固定名 `letters_runner`。
4. `gui/custom_gui/letters_runner.gui` 轮流运行 `letters.txt` 与 `votc.txt`；`talk_scene` 存在时按既有逻辑清理 runner。

加载入口是本轮 Mod 修复点；后三项是它依赖的既有运行链。完整静态调用关系与代码结果见[信件调度与记忆重试热修报告](v8.14.2-letter-memory-retry-hotfix-report.md)。

## 已检查的 Mod 内容基线

下列 SHA-256 于 `2026-10-05` 从本机目录 `D:\SteamLibrary\steamapps\workshop\content\1158310\3346777360` 读取。路径是相对 Workshop item 根目录；指纹用于精确识别本次核对内容，文件任一字节变化都会产生不同指纹。

| Mod 相对路径 | SHA-256 | 作用 |
|---|---|---|
| `descriptor.mod` | `B934063E499A8A3450DF25655E8FD09A7597BE1E9EC0187B78DF778E9D5F2B12` | item ID、版本及 CK3 支持版本元数据 |
| `common/on_action/votc_load_boundary.txt` | `FF65C8483236929FC78C65E2A0CDF6558BEE7863A7D08ED45449213B2641937F` | 必需的读档/开局延迟自举补丁 |
| `events/mcc_events_v2.txt` | `4E5C2A4B20E7CC51474D64E2EE2735D729A0D69C0126B5290F01F6F67FE9C56D` | `.9998` 事件入口 |
| `gui/event_windows/votc_invisible_event.gui` | `CD5A6DC5082BF01E149C096D3F853F566BE432A23659197E33858D5DFB06F356` | 结束不可见事件窗口时重建 runner |
| `gui/custom_gui/letters_runner.gui` | `AFD1F7ACA2120577E92AB37450A96A47013CBE79AFA993BBDDE2EE1A45C3DF28` | 日期/信件命令 runner |

复核时把 `$modRoot` 指向实际 Workshop item 根目录，再运行只读 PowerShell 检查。此检查验证内容快照，不替代 CK3 脚本执行或实机验收：

```powershell
$modRoot = 'D:\SteamLibrary\steamapps\workshop\content\1158310\3346777360'
$expected = [ordered]@{
  'descriptor.mod' = 'B934063E499A8A3450DF25655E8FD09A7597BE1E9EC0187B78DF778E9D5F2B12'
  'common/on_action/votc_load_boundary.txt' = 'FF65C8483236929FC78C65E2A0CDF6558BEE7863A7D08ED45449213B2641937F'
  'events/mcc_events_v2.txt' = '4E5C2A4B20E7CC51474D64E2EE2735D729A0D69C0126B5290F01F6F67FE9C56D'
  'gui/event_windows/votc_invisible_event.gui' = 'CD5A6DC5082BF01E149C096D3F853F566BE432A23659197E33858D5DFB06F356'
  'gui/custom_gui/letters_runner.gui' = 'AFD1F7ACA2120577E92AB37450A96A47013CBE79AFA993BBDDE2EE1A45C3DF28'
}

foreach ($relativePath in $expected.Keys) {
  $path = Join-Path $modRoot $relativePath
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Missing required Mod file: $relativePath"
  }
  $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
  if ($actual -ne $expected[$relativePath]) {
    throw "Fingerprint mismatch: $relativePath ($actual)"
  }
  Write-Output "PASS $relativePath"
}

$descriptor = Get-Content -LiteralPath (Join-Path $modRoot 'descriptor.mod') -Raw
foreach ($field in @('version="2.0.4"', 'name="Voices of the Court 2.0"', 'supported_version="1.20.*"', 'remote_file_id="3346777360"')) {
  if (-not $descriptor.Contains($field)) { throw "Descriptor field mismatch: $field" }
}
Write-Output 'PASS descriptor identity'
```

若未来 Mod 发布改变上述文件，先检查其是否仍满足调用关系，再更新本表和合同基线；静态哈希匹配只表示与已检查快照相同。Mod 与 App 的版本号不能替代这一步。

## CK3 实机 Gate

实施报告记录了 Mod scope/编码结构静态检查和 App 发布门禁通过，但没有把这些结果当作 CK3 脚本执行。以下四项均须由用户在真实 CK3 中验收；目前状态为待验收，不能据此签发 Full Freeze。

| Gate | 操作 | 通过条件 |
|---|---|---|
| L1 读档自举 | 准备至少一封 pending letter，完全关闭 CK3 后重启并读档；不开始新对话，推进至少一天 | 新日期 marker 出现，Date Runner 恢复 |
| L2 超期信件 | 读档含已过期 pending letter 的存档，推进 1–2 天 | Effect 写入、宝物生成、弹窗、`LETTER_ACCEPTED` 与 `SENT` 顺序完成 |
| L3 不重复 | 对同一信件重复关闭/重启、读档及日期推进 | 不重复生成宝物、弹窗、归档或 Detail |
| L4 对话存档兼容 | 在 `talk_scene` 中存档并读档，随后验证对话结束及日期推进 | 不误投重复信件；runner 遵守既有活动对话清理规则；conversation-close ACK 不受破坏 |

L1-L4 的详细前置条件和信件/Memory Gate 见上述实施报告。报告还指出：若存档保留 `talk_scene` 却未恢复关闭事件，runner 会按既有规则自行清理；本合同不要求清除玩家的活动对话变量。
