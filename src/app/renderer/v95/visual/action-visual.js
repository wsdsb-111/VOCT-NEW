/** Action activity presentation. ACK/UNKNOWN/CONFIRMED remain distinct. */
import { mountListShell } from "./list-shell.js";

export const VIEW_KIND = "action-activity";

export function mountView(container, view, context = {}) {
  return mountListShell(container, view, context);
}

export default mountView;
