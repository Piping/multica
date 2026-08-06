import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@multica/core/i18n/react";
import enCommon from "../../locales/en/common.json";
import enSettings from "../../locales/en/settings.json";

const logout = vi.hoisted(() => vi.fn());

vi.mock("@multica/core/auth", () => ({
  useAuthStore: (
    selector: (state: {
      user: {
        id: string;
        name: string;
        email: string;
        avatar_url: null;
        profile_description: string;
      };
      setUser: () => void;
    }) => unknown,
  ) =>
    selector({
      user: {
        id: "user-1",
        name: "Ada Lovelace",
        email: "ada@example.com",
        avatar_url: null,
        profile_description: "",
      },
      setUser: vi.fn(),
    }),
}));

vi.mock("@multica/core/api", () => ({
  api: {
    getBaseUrl: () => "http://127.0.0.1:8080",
    updateMe: vi.fn(),
  },
}));

vi.mock("../../auth", () => ({
  useLogout: () => logout,
}));

vi.mock("../../common/avatar-upload-control", () => ({
  AvatarUploadControl: () => <div data-testid="avatar-upload" />,
}));

vi.mock("./use-auto-save", () => ({
  useAutoSave: () => ({
    status: "idle",
    flush: vi.fn(),
  }),
}));

const TEST_RESOURCES = {
  en: { common: enCommon, settings: enSettings },
};

function I18nWrapper({ children }: { children: ReactNode }) {
  return (
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      {children}
    </I18nProvider>
  );
}

import { AccountTab } from "./account-tab";

describe("AccountTab session controls", () => {
  beforeEach(() => {
    logout.mockReset();
  });

  it("shows the active account and logs out through the shared flow", () => {
    render(<AccountTab />, { wrapper: I18nWrapper });

    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    expect(logout).toHaveBeenCalledTimes(1);
  });
});
