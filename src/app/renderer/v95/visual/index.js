/** V9.5 visual layer public surface (DeepSeek delivery). */
export { defaultIconRegistry, hasIcon, renderIcon, listIcons, getIconCatalog, ICON_CATALOG } from "../icons/icon-registry.js";
export { mountListShell, VIEW_CONFIG } from "./list-shell.js";
export { createRow } from "./row-components.js";
export { createBadge, createStatusBadge, createStatePanel, createInlineStatus, createSkeletonRows } from "./status-indicator.js";
export { createIconButton, createTextButton } from "./icon-button.js";
export { mountDialog, mountConfirmDialog } from "./dialog-shell.js";
export { swapView, markEntered } from "./view-transition.js";
export { mountView as mountConversation } from "./conversation-visual.js";
export { mountView as mountMemory } from "./memory-visual.js";
export { mountView as mountKnowledge } from "./knowledge-visual.js";
export { mountView as mountWorldline } from "./worldline-visual.js";
export { mountView as mountLetters } from "./letter-visual.js";
export { mountView as mountActions } from "./action-visual.js";
export { mountView as mountProvider } from "./provider-visual.js";
export { mountView as mountSettings } from "./settings-visual.js";

import { mountView as mountConversationView } from "./conversation-visual.js";
import { mountView as mountMemoryView } from "./memory-visual.js";
import { mountView as mountKnowledgeView } from "./knowledge-visual.js";
import { mountView as mountWorldlineView } from "./worldline-visual.js";
import { mountView as mountLetterView } from "./letter-visual.js";
import { mountView as mountActionView } from "./action-visual.js";
import { mountView as mountProviderView } from "./provider-visual.js";
import { mountView as mountSettingsView } from "./settings-visual.js";

export const VISUAL_VERSION = "v95-visual-v1";
export const MOUNTERS = Object.freeze({
  "conversation-feed": mountConversationView,
  "memory-list": mountMemoryView,
  "knowledge-facts": mountKnowledgeView,
  "worldline-timeline": mountWorldlineView,
  "letter-list": mountLetterView,
  "action-activity": mountActionView,
  "provider-diagnostics": mountProviderView,
  "settings-section": mountSettingsView
});

export function mountByKind(container, view, context = {}) {
  const mounter = view && MOUNTERS[view.kind];
  if (typeof mounter !== "function") throw new Error("V95_UNKNOWN_VIEW_KIND");
  return mounter(container, view, context);
}
