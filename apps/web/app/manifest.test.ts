import { describe, expect, it } from "vitest";
import manifest from "./manifest";

describe("manifest", () => {
  it("exposes installable PWA metadata", () => {
    const result = manifest();

    expect(result.name).toBe("Multica");
    expect(result.short_name).toBe("Multica");
    expect(result.display).toBe("standalone");
    expect(result.start_url).toBe("/");
    expect(result.scope).toBe("/");
    expect(result.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          src: "/icon-192.png",
          sizes: "192x192",
          type: "image/png",
        }),
        expect.objectContaining({
          src: "/icon-512.png",
          sizes: "512x512",
          type: "image/png",
        }),
      ]),
    );
  });
});
