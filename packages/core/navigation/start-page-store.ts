import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { defaultStorage } from "../platform/storage";

export const START_PAGES = ["issues", "agent"] as const;

export type StartPage = (typeof START_PAGES)[number];

interface StartPageState {
  startPage: StartPage;
  setStartPage: (page: StartPage) => void;
}

/**
 * Personal device preference used when Multica needs a fresh workspace entry
 * point. Existing in-app navigation and restored desktop tabs remain intact.
 */
export const useStartPageStore = create<StartPageState>()(
  persist(
    (set) => ({
      startPage: "issues",
      setStartPage: (startPage) => set({ startPage }),
    }),
    {
      name: "multica_start_page",
      storage: createJSONStorage(() => defaultStorage),
      partialize: (state) => ({ startPage: state.startPage }),
    },
  ),
);
