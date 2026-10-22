/** Provider diagnostics presentation. Native and estimated usage stay distinct. */
import { mountListShell } from "./list-shell.js";

export const VIEW_KIND = "provider-diagnostics";

export function mountView(container, view, context = {}) {
  return mountListShell(container, view, context);
}

export default mountView;
