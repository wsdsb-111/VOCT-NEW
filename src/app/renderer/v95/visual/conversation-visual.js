/** Conversation feed presentation. Rows are messages; no send/generate controls. */
import { mountListShell } from "./list-shell.js";

export const VIEW_KIND = "conversation-feed";

export function mountView(container, view, context = {}) {
  return mountListShell(container, view, context);
}

export default mountView;
