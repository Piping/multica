/**
 * Screen-scoped state for the issue comment composer's selected destination.
 *
 * Product model:
 *   - "main" => default reply path; comment lands in the issue's primary
 *     thread (the first root comment when one exists, otherwise a new
 *     top-level thread is started)
 *   - "thread" => explicit existing thread root
 *   - "new" => force a brand-new top-level thread
 *
 * We store only the mode + root id. Display metadata comes from the live
 * timeline so it can't drift after edits / deletes / resolve toggles.
 */
import { create } from "zustand";

export type CommentThreadMode = "main" | "thread" | "new";

export interface CommentThreadTarget {
  mode: CommentThreadMode;
  rootCommentId: string | null;
}

interface State {
  target: CommentThreadTarget;
  focusKey: string | null;
  setTarget: (target: CommentThreadTarget) => void;
  reset: () => void;
}

function makeFocusKey() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const DEFAULT_TARGET: CommentThreadTarget = {
  mode: "main",
  rootCommentId: null,
};

export const useCommentThreadTargetStore = create<State>((set) => ({
  target: DEFAULT_TARGET,
  focusKey: null,
  setTarget: (target) => set({ target, focusKey: makeFocusKey() }),
  reset: () => set({ target: DEFAULT_TARGET, focusKey: makeFocusKey() }),
}));
