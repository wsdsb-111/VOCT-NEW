/** Letter list presentation. Delivery state is never inferred from a badge. */
import { mountListShell } from "./list-shell.js";

export const VIEW_KIND = "letter-list";

export function mountView(container, view, context = {}) {
  return mountListShell(container, view, context);
}

export default mountView;
