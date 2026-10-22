/** Character knowledge presentation. Displays only authorized rows. */
import { mountListShell } from "./list-shell.js";

export const VIEW_KIND = "knowledge-facts";

export function mountView(container, view, context = {}) {
  return mountListShell(container, view, context);
}

export default mountView;
