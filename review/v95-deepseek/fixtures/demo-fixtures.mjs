/**
 * Synthetic showcase fixtures. These are demo-only, use the frozen v1 contract,
 * and never touch real IPC, memory, characters or CK3 data.
 */
import {
  CONTRACT_VERSION, VIEW_KINDS, assertView
} from "../../../src/app/renderer/v95/contracts/view-contract.v1.js";
import { createViewFixtures } from "../../../src/app/renderer/v95/contracts/view-fixtures.v1.js";
import { UI_CATALOGS } from "../../../src/app/renderer/v95/i18n/index.js";

const SCOPE = "demo-scope-v95";
const REVISION = "demo-revision-1";

const TITLE_KEYS = Object.freeze({
  "conversation-feed": "conversation.title",
  "memory-list": "memory.title",
  "knowledge-facts": "knowledge.title",
  "worldline-timeline": "worldline.title",
  "letter-list": "letters.title",
  "action-activity": "actions.title",
  "provider-diagnostics": "diagnostics.title",
  "settings-section": "settings.title"
});

function view(kind, rows, overrides = {}) {
  return assertView({
    contractVersion: CONTRACT_VERSION,
    kind,
    state: "ready",
    scopeTag: SCOPE,
    revisionTag: REVISION,
    titleKey: TITLE_KEYS[kind],
    rows,
    emptyTextKey: "common.noResults",
    errorCode: null,
    pagination: { page: 1, pageSize: 20, total: rows.length },
    ...overrides
  });
}

function row(id, title, overrides = {}) {
  return {
    id,
    title,
    subtitle: "",
    dateText: "",
    badge: null,
    icon: "unknown",
    disabled: false,
    actions: ["OPEN_DETAIL"],
    ...overrides
  };
}

export function createDemoTranslator(language = "zh-CN") {
  const locale = language === "en-US" ? "en-US" : "zh-CN";
  const catalog = UI_CATALOGS[locale];
  function resolve(key) {
    return key.split(".").reduce((value, part) => (value && Object.hasOwn(value, part) ? value[part] : undefined), catalog);
  }
  function interpolate(template, params) {
    return template.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (_, name) => {
      const value = params && Object.hasOwn(params, name) ? params[name] : undefined;
      return value === undefined || value === null ? "" : String(value);
    });
  }
  return function t(key, params = {}) {
    if (typeof key !== "string") return catalog.common.unavailable;
    const value = resolve(key);
    if (typeof value !== "string") return catalog.common.unavailable;
    const result = interpolate(value, params);
    return result && !result.includes("{{") ? result : catalog.common.unavailable;
  };
}

export function createDemoViews(language = "zh-CN") {
  const zh = language !== "en-US";
  const views = {
    "conversation-feed": view("conversation-feed", [
      row("demo-conv-1", zh ? "司礼官" : "Master of Ceremonies", {
        role: "system",
        icon: "conversation",
        badge: null,
        timeText: zh ? "当前" : "Now",
        text: zh ? "公元 1013 年 10 月 16 日 · 汴京宫廷 · 私人书房" : "16 October 1013 · Bianjing court · private study",
        actions: []
      }),
      row("demo-conv-2", zh ? "你" : "You", {
        role: "player",
        icon: "conversation",
        timeText: zh ? "稍后" : "Later",
        text: zh ? "今日朝中议论纷纷，你对此事如何看待？" : "The court is full of rumours today. How do you read the matter?",
        actions: ["OPEN_DETAIL"]
      }),
      row("demo-conv-3", zh ? "赵从绍" : "Zhao Congshao", {
        role: "npc",
        icon: "conversation",
        timeText: zh ? "片刻后" : "A moment later",
        streaming: true,
        text: zh ? "臣以为此事不可操之过急。若先查清各方意图，再作决断，或许更为稳妥。" : "I would not rush this. If we first learn what each party intends, the decision may be steadier.",
        actions: ["OPEN_DETAIL"]
      })
    ], { titleKey: "conversation.title" }),
    "memory-list": view("memory-list", [
      row("demo-memory-1", zh ? "边境的冬天与粮仓" : "Winter on the border", {
        icon: "memory",
        subtitle: zh ? "赵从绍 · 私人书房" : "Zhao Congshao · private study",
        dateText: zh ? "1013.10.16" : "1013.10.16",
        badge: { tone: "success", textKey: "memory.verified" },
        text: zh ? "封臣请求先修粮仓、再修城墙。领主承诺在春耕前复核边军粮草。" : "The vassal asked for granaries before walls. The lord promised to review the border stores before spring planting.",
        actions: ["OPEN_DETAIL", "OPEN_SOURCE"]
      }),
      row("demo-memory-2", zh ? "一封迟来的信" : "A letter delayed", {
        icon: "memory",
        subtitle: zh ? "远方的故人 · 信件" : "An old friend · letter",
        dateText: zh ? "1013.09.02" : "1013.09.02",
        badge: { tone: "neutral", textKey: "status.UNKNOWN" },
        text: zh ? "信件在秋雨里迟到了三日；具体送达时间仍未核实。" : "The letter arrived three days late in autumn rain; exact delivery is unverified.",
        actions: ["OPEN_DETAIL"]
      }),
      row("demo-memory-3", zh ? "宴会上的约定" : "A promise at the feast", {
        icon: "memory",
        subtitle: zh ? "密谈对象 · 宴席一角" : "Confidant · corner of the feast",
        dateText: "",
        badge: { tone: "info", textKey: "status.SOURCE_BOUND" },
        text: zh ? "宴后单独商议；只对指定听众披露，候场者不会自动获知。" : "Discussed after the feast; only the named listener was told, not the waiting guests.",
        actions: ["OPEN_DETAIL", "OPEN_SOURCE"]
      })
    ], { pagination: { page: 1, pageSize: 20, total: 48 } }),
    "knowledge-facts": view("knowledge-facts", [
      row("demo-known-1", zh ? "赵从绍 · 已知：谨慎" : "Zhao Congshao · Known: Cautious", {
        icon: "knowledge",
        subtitle: zh ? "来源：对话披露" : "Source: conversation disclosure",
        dateText: zh ? "1013.10.16" : "1013.10.16",
        badge: { tone: "info", textKey: "status.SOURCE_BOUND" },
        text: zh ? "此特质由本场公开对话披露。" : "This trait was disclosed in the current public conversation.",
        actions: ["OPEN_DETAIL", "OPEN_SOURCE", "REQUEST_EDIT"]
      }),
      row("demo-known-2", zh ? "沈砚 · 人工已知：抱负" : "Shen Yan · Marked known: Ambitious", {
        icon: "knowledge",
        subtitle: zh ? "来源：人工认知设置" : "Source: manual knowledge setting",
        dateText: zh ? "1013.09.20" : "1013.09.20",
        badge: { tone: "info", textKey: "status.SOURCE_BOUND" },
        text: zh ? "只改变这位听众对该特质的认知方向。" : "Only this listener's knowledge of the trait was changed.",
        actions: ["OPEN_DETAIL", "REQUEST_EDIT"]
      }),
      row("demo-known-3", zh ? "未知人物 · 未确认" : "Unknown person · Unconfirmed", {
        icon: "knowledge",
        subtitle: zh ? "来源：未分类" : "Source: unclassified",
        badge: { tone: "warning", textKey: "status.UNKNOWN" },
        text: zh ? "未获得足够披露，不推断更多信息。" : "Not enough disclosure; no further inference.",
        actions: ["OPEN_DETAIL"]
      })
    ]),
    "worldline-timeline": view("worldline-timeline", [
      row("demo-world-1", zh ? "当前事实：领主仍在汴京" : "Current fact: the lord is in Bianjing", {
        icon: "worldline",
        subtitle: zh ? "CK3 当前回读" : "Current CK3 readback",
        dateText: zh ? "1013.10.16" : "1013.10.16",
        badge: { tone: "success", textKey: "status.CONFIRMED" },
        text: zh ? "来自当前运行数据；历史叙事不得覆盖。" : "From current runtime data; historical narrative must not override it.",
        actions: ["OPEN_DETAIL"]
      }),
      row("demo-world-2", zh ? "历史：秋日宴席" : "History: the autumn feast", {
        icon: "worldline",
        subtitle: zh ? "历史记录 · 只读" : "Historical record · read-only",
        dateText: zh ? "1013.09.29" : "1013.09.29",
        badge: { tone: "info", textKey: "status.SOURCE_BOUND" },
        text: zh ? "宴会记录与当前事实并列时，以当前事实为准。" : "When placed beside current facts, current facts win.",
        actions: ["OPEN_DETAIL", "OPEN_SOURCE"]
      }),
      row("demo-world-3", zh ? "证据时点未知" : "Evidence time unknown", {
        icon: "worldline",
        subtitle: zh ? "来源：未记录" : "Source: unrecorded",
        badge: { tone: "neutral", textKey: "status.UNKNOWN" },
        text: zh ? "日期未知，不据此推断先后。" : "Date unknown; no ordering inferred.",
        actions: ["OPEN_DETAIL"]
      })
    ], { pagination: { page: 1, pageSize: 20, total: 31 } }),
    "letter-list": view("letter-list", [
      row("demo-letter-1", zh ? "致北境故人" : "To a friend in the north", {
        icon: "letter",
        subtitle: zh ? "收件人：远方的故人" : "To: an old friend",
        dateText: zh ? "1013.10.12" : "1013.10.12",
        stage: "ACKNOWLEDGED",
        effectState: "UNKNOWN",
        queueTimeText: zh ? "已排队 2 分钟" : "Queued 2 minutes",
        text: zh ? "北方的风是否依旧凛冽？我还记得我们上次分别时的约定。" : "Is the northern wind still sharp? I remember the promise we made when we parted.",
        actions: ["OPEN_DETAIL", "REQUEST_APPROVAL"]
      }),
      row("demo-letter-2", zh ? "写给司礼官" : "To the master of ceremonies", {
        icon: "letter",
        subtitle: zh ? "收件人：司礼官" : "To: master of ceremonies",
        dateText: zh ? "1013.10.03" : "1013.10.03",
        stage: "CONFIRMED",
        effectState: "CONFIRMED",
        text: zh ? "信件已由游戏回读确认，不是仅收到 ACK。" : "The letter is confirmed by game readback, not merely acknowledged.",
        actions: ["OPEN_DETAIL", "OPEN_SOURCE"]
      })
    ]),
    "action-activity": view("action-activity", [
      row("demo-action-1", zh ? "奉茶" : "Serve tea", {
        icon: "action",
        subtitle: zh ? "对象：赵从绍" : "Target: Zhao Congshao",
        dateText: zh ? "1013.10.16" : "1013.10.16",
        stage: "ACKNOWLEDGED",
        effectState: "UNKNOWN",
        queueTimeText: zh ? "等待可靠确认" : "Awaiting reliable confirmation",
        actions: ["OPEN_DETAIL"]
      }),
      row("demo-action-2", zh ? "转移 20 金币" : "Transfer 20 gold", {
        icon: "action",
        subtitle: zh ? "对象：沈砚 · 需审查" : "Target: Shen Yan · review required",
        dateText: zh ? "1013.10.15" : "1013.10.15",
        stage: "QUEUED",
        effectState: "UNCONFIRMED",
        queueTimeText: zh ? "已排队 4 分钟" : "Queued 4 minutes",
        actions: ["OPEN_DETAIL", "REQUEST_APPROVAL"]
      }),
      row("demo-action-3", zh ? "修改边境布防" : "Adjust border levy", {
        icon: "action",
        subtitle: zh ? "对象：北境" : "Target: northern march",
        dateText: zh ? "1013.10.09" : "1013.10.09",
        stage: "CONFIRMED",
        effectState: "CONFIRMED",
        actions: ["OPEN_DETAIL"]
      })
    ]),
    "provider-diagnostics": view("provider-diagnostics", [
      row("demo-diag-1", zh ? "缓存命中率" : "Cache hit rate", {
        icon: "provider",
        subtitle: zh ? "服务商原生报告" : "Provider reported",
        metric: { value: 81.4, unit: "%", estimateKind: "native", progress: 0.814 },
        actions: ["OPEN_DETAIL"]
      }),
      row("demo-diag-2", zh ? "本场前缀估算" : "Local prefix estimate", {
        icon: "provider",
        subtitle: zh ? "估算" : "Estimated",
        metric: { value: 18400, unit: "tokens", estimateKind: "estimated", progress: null },
        actions: ["OPEN_DETAIL"]
      }),
      row("demo-diag-3", zh ? "首字延迟" : "Time to first token", {
        icon: "provider",
        subtitle: zh ? "未报告" : "Not reported",
        metric: { value: null, unit: "ms", estimateKind: "unknown", progress: null },
        actions: ["OPEN_DETAIL"]
      }),
      row("demo-diag-4", zh ? "本场请求" : "Requests this session", {
        icon: "provider",
        subtitle: zh ? "服务商原生报告" : "Provider reported",
        metric: { value: 12, unit: "requests", estimateKind: "native", progress: null },
        actions: ["OPEN_DETAIL"]
      })
    ]),
    "settings-section": view("settings-section", [
      row("demo-setting-1", zh ? "界面语言" : "Interface language", {
        icon: "settings",
        actions: ["CHANGE_FILTER"],
        control: {
          type: "select",
          value: language,
          options: [
            { value: "zh-CN", labelKey: "settings.chinese" },
            { value: "en-US", labelKey: "settings.english" }
          ],
          helpTextKey: "settings.languageHelp"
        }
      }),
      row("demo-setting-2", zh ? "既有动作语言" : "Existing action language", {
        icon: "settings",
        actions: [],
        control: { type: "readOnly", value: "en" }
      }),
      row("demo-setting-3", zh ? "游戏语言" : "Game language", {
        icon: "settings",
        actions: [],
        control: { type: "readOnly", value: null }
      })
    ])
  };
  return views;
}

export function createDemoStateView(kind, state, language = "zh-CN") {
  if (!VIEW_KINDS.includes(kind)) throw new Error("unknown kind");
  if (state === "refreshing") {
    const base = createDemoViews(language)[kind];
    return assertView({ ...base, state: "refreshing", errorCode: null });
  }
  if (state === "idle") {
    const base = createDemoViews(language)[kind];
    return assertView({
      ...base, state: "idle", rows: [], errorCode: null,
      pagination: { page: 1, pageSize: 20, total: 0 }
    });
  }
  const fixture = createViewFixtures(language).find(entry => entry.kind === kind && entry.state === state);
  if (!fixture) throw new Error(`no fixture ${kind}/${state}`);
  return fixture;
}
