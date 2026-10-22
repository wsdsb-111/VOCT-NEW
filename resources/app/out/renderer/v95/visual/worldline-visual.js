/** Worldline timeline presentation. Facts remain read-only. */
import { mountListShell } from "./list-shell.js";

export const VIEW_KIND = "worldline-timeline";

export function mountView(container, view, context = {}) {
  return mountListShell(container, view, context);
}

export default mountView;
