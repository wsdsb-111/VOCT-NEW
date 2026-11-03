export function CampaignBackgroundEditor({ react: R, t }) {
  const h = R.createElement;
  const tr = (key, params) => t?.(`worldBackground.${key}`, params) || key;
  const [data, setData] = R.useState(null);
  const [text, setText] = R.useState("");
  const [phase, setPhase] = R.useState("loading");
  const [notice, setNotice] = R.useState("");
  const [conflict, setConflict] = R.useState(null);
  const sequence = R.useRef(0), mounted = R.useRef(false), loaded = R.useRef(null), draft = R.useRef("");
  const api = window.worldlineAPI;
  const showError = error => {
    const known = ["world_background_campaign_changed", "world_background_revision_changed", "world_background_too_long", "world_background_store_invalid"];
    return tr(known.find(code => String(error?.message || "").includes(code)) || "failed");
  };
  const refresh = async () => {
    const request = ++sequence.current;
    setPhase("loading");
    try {
      const next = await api.getBackgroundSetting();
      if (!mounted.current || request !== sequence.current) return;
      const keepDraft = next.available && next.bindingKey === loaded.current?.bindingKey && draft.current !== loaded.current.text;
      if (keepDraft && next.revision !== loaded.current.revision) {
        setConflict(next); setNotice(tr("world_background_revision_changed")); setPhase("error"); return;
      }
      setConflict(null);
      loaded.current = next; setData(next);
      if (!keepDraft) { draft.current = next.text; setText(next.text); }
      setNotice(""); setPhase("ready");
    } catch (error) {
      if (!mounted.current || request !== sequence.current) return;
      setNotice(showError(error)); setPhase("error");
    }
  };
  R.useEffect(() => {
    mounted.current = true;
    refresh();
    const unsubscribe = api?.onUpdated?.(() => { refresh(); });
    return () => { mounted.current = false; sequence.current++; unsubscribe?.(); };
  }, []);
  const save = async () => {
    const request = ++sequence.current;
    setPhase("saving");
    try {
      const next = await api.saveBackgroundSetting({ bindingKey: data.bindingKey, revision: data.revision, text: draft.current });
      if (!mounted.current || request !== sequence.current) return;
      loaded.current = next; draft.current = next.text;
      setData(next); setText(next.text); setPhase("ready"); setNotice(tr("saved"));
    } catch (error) {
      if (!mounted.current || request !== sequence.current) return;
      setNotice(showError(error)); setPhase("error");
    }
  };
  const count = Array.from(text).length;
  const available = data?.available === true;
  return h("section", { className: "worldline-card worldline-editor", "aria-busy": phase === "loading" || phase === "saving" },
    h("h4", null, tr("title")), h("p", { className: "muted-text" }, tr("help")),
    h("p", null, available ? tr("bound") : tr("unbound")),
    h("label", { htmlFor: "campaign-background-text" }, tr("content")),
    h("textarea", { id: "campaign-background-text", value: text, rows: 10, disabled: !available || phase !== "ready",
      placeholder: tr("placeholder"), style: { width: "100%", resize: "vertical" }, "aria-invalid": count > 3000,
      "aria-describedby": "campaign-background-count",
      onChange: event => { draft.current = event.target.value; setText(event.target.value); setNotice(""); } }),
    h("p", { id: "campaign-background-count", role: count > 3000 ? "alert" : undefined }, tr("count", { count, limit: 3000 })),
    h("div", { className: "worldline-actions" },
      h("button", { type: "button", disabled: !available || phase !== "ready" || count > 3000 || text === data?.text, onClick: save }, tr("save")),
      h("button", { type: "button", disabled: phase === "loading" || phase === "saving", onClick: refresh }, tr("refresh"))),
    conflict && h("button", { type: "button", onClick: () => {
      if (loaded.current?.bindingKey !== conflict.bindingKey) return;
      loaded.current = conflict; draft.current = conflict.text;
      setData(conflict); setText(conflict.text); setConflict(null); setNotice(""); setPhase("ready");
    } }, tr("reloadSaved")),
    notice && h("p", { role: phase === "error" ? "alert" : "status" }, notice));
}
