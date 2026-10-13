# V9.3.1 问题台账

本轮以V9.3最终提交6e23209为基线；不撤销此前人工验收，不借用旧CI签署新候选。最终状态见[验证报告](V9_3_1_VERIFICATION_REPORT.md)。

| 编号 | 本轮处置 | 证据／限制 |
|---|---|---|
| V931-P1-01 | Gemini原生用量修复候选 | Adapter白名单、原生缓存／思考、total多组成分、visible candidates、writer／diagnostic端到端及部分／空尾帧RED→GREEN。真实Gemini端点未验证。 |
| V931-P2-01 | Action诊断修复候选 | attempted／accepted／confirmed分层；FAILED／无ID不得dispatched，先接受后失败保留命令及待ACK证据。Writer／ACK协议不改，无实际Effect测试。 |
| V931-HOLD-01 | P1-HOLD → V9.4 | GLM长局缓存问题保留，未改v813或clear_thinking，不宣称命中率改善。 |
| V931-GATE-01 | NOT_VERIFIED | 最终SHA远端CI、CK3三人对话／Durable／Action／Letter与Soak待本轮单独验收；用户自行推送。 |
| V931-NV-01 | Mock范围保留 | Gemini／Player2／Ollama没有真实端点证据；本轮全部离线、新付费请求0。 |

新增流尾包缺陷是本轮原生字段修复范围内的补充反例，原C0 RED不覆盖；不通过删断言、改Golden、静默填零或重发真实请求改善统计。
