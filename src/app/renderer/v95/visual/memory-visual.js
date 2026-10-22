/** Legacy Summary / Pair ledger presentation. */
import { mountListShell } from "./list-shell.js";

export const VIEW_KIND = "memory-list";

export function mountView(container, view, context = {}) {
  return mountListShell(container, view, context);
}

export default mountView;
