/** Settings section presentation. Controls emit CHANGE_FILTER only. */
import { mountListShell } from "./list-shell.js";

export const VIEW_KIND = "settings-section";

export function mountView(container, view, context = {}) {
  return mountListShell(container, view, context);
}

export default mountView;
