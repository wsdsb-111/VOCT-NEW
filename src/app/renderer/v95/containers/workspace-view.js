import { createWorkspaceController } from "./workspace-controller.js";
import { createSnapshotPresentation } from "./snapshot-presentation.js";
import { DOMAIN_ADAPTERS } from "../adapters/domain-adapters.js";

// React is the existing bundled instance, not a second framework/runtime.
export function createWorkspaceView(React, jsx, runtime, apis) {
  return function WorkspaceView({ onOpenControls }) {
    const [kind, setKind] = React.useState("conversation-feed");
    const [status, setStatus] = React.useState("loading");
    const [errorCode, setErrorCode] = React.useState(null);
    const [language, setLanguage] = React.useState(runtime.getPreferences().uiLanguage);
    const host = React.useRef(null);
    const loader = React.useRef(null);
    const presentation = React.useRef(null);
    const requestSequence = React.useRef(0);
    const latestLoad = React.useRef(null);

    async function refresh() {
      const sequence = ++requestSequence.current;
      setStatus("loading");
      setErrorCode(null);
      presentation.current?.setState("loading");
      const result = await loader.current.load(kind);
      if (sequence !== requestSequence.current) return;
      if (!result.committed || !result.isCurrent()) {
        setStatus("stale"); setErrorCode(result.errorCode || "STALE_CONTEXT");
        presentation.current?.setState("stale", result.errorCode || "STALE_CONTEXT");
        return;
      }
      if (result.errorCode) {
        setStatus("error"); setErrorCode(result.errorCode);
        presentation.current?.setState("error", result.errorCode);
        return;
      }
      setStatus(result.records.length ? "ready" : "empty");
      await presentation.current?.update(result.records);
    }
    latestLoad.current = refresh;

    React.useEffect(() => runtime.subscribe(({ preferences }) => setLanguage(preferences.uiLanguage)), []);
    React.useEffect(() => {
      loader.current = createWorkspaceController({ runtime, apis });
      presentation.current = createSnapshotPresentation(host.current, { kind, runtime,
        onRefresh: () => latestLoad.current?.() });
      const unsubscribe = runtime.subscribeContext(() => { void latestLoad.current?.(); });
      // The context subscription invokes once on registration.
      return () => {
        ++requestSequence.current;
        unsubscribe(); loader.current?.dispose(); loader.current = null;
        presentation.current?.destroy(); presentation.current = null;
      };
    }, [kind]);

    return jsx.jsxs("section", { className: "v95-workspace", lang: language, children: [
      jsx.jsxs("header", { className: "v95-workspace-heading", children: [
        jsx.jsx("h3", { children: runtime.t("workspace.title") }),
        jsx.jsx("p", { children: runtime.t("workspace.readOnly") })
      ] }),
      jsx.jsxs("div", { className: "v95-workspace-toolbar", children: [
        jsx.jsxs("label", { children: [runtime.t("workspace.section"),
          jsx.jsx("select", { value: kind, "aria-label": runtime.t("workspace.section"),
            onChange: event => setKind(event.target.value), children: Object.entries(DOMAIN_ADAPTERS).map(([value, adapter]) =>
              jsx.jsx("option", { value, children: runtime.t(adapter.titleKey) }, value)) })
        ] }),
        jsx.jsx("button", { type: "button", onClick: () => { void refresh(); }, disabled: status === "loading",
          children: runtime.t("common.refresh") }),
        jsx.jsx("button", { type: "button", onClick: () => onOpenControls(kind), children: runtime.t("workspace.openControls") })
      ] }),
      errorCode && jsx.jsx("p", { role: "alert", children: runtime.t(`errors.${errorCode}`) }),
      jsx.jsx("div", { className: "v95-slot v95-workspace-slot", ref: host })
    ] });
  };
}
