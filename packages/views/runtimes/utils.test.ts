import { describe, it, expect } from "vitest";

import { collectUnmappedModels, estimateCost, isModelPriced } from "./utils";

const zeroUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
};

describe("estimateCost", () => {
  it("prices the canonical Anthropic Sonnet 4.6 SKU", () => {
    const cost = estimateCost({
      ...zeroUsage,
      model: "claude-sonnet-4-6",
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    // 1M × $3 input + 1M × $15 output = $18.
    expect(cost).toBeCloseTo(18, 5);
  });

  it("prices a Codex CLI session reporting gpt-5-codex", () => {
    const cost = estimateCost({
      ...zeroUsage,
      model: "gpt-5-codex",
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_tokens: 2_000_000,
    });
    // 1M × $1.25 + 1M × $10 + 2M × $0.125 = $11.50.
    expect(cost).toBeCloseTo(11.5, 5);
  });

  it("falls through to gpt-5 pricing for snapshot-suffixed model strings", () => {
    // OpenAI sometimes returns dated snapshots (e.g. gpt-5-2025-08-07).
    // The startsWith() fallback in resolvePricing should still resolve them
    // to the gpt-5 family, so cost lands above $0.
    const cost = estimateCost({
      ...zeroUsage,
      model: "gpt-5-2025-08-07",
      input_tokens: 1_000_000,
    });
    expect(cost).toBeGreaterThan(0);
  });

  it("returns 0 for a genuinely unknown model so the UI can flag it", () => {
    expect(
      estimateCost({
        ...zeroUsage,
        model: "totally-made-up-model",
        input_tokens: 1_000_000,
      }),
    ).toBe(0);
  });
});

describe("isModelPriced", () => {
  it("recognises both Claude and Codex/GPT families", () => {
    expect(isModelPriced("claude-sonnet-4-6")).toBe(true);
    expect(isModelPriced("gpt-5-codex")).toBe(true);
    expect(isModelPriced("gpt-5-mini")).toBe(true);
    expect(isModelPriced("o3")).toBe(true);
    expect(isModelPriced("totally-made-up-model")).toBe(false);
  });
});

describe("collectUnmappedModels", () => {
  it("only surfaces names that miss every pricing tier", () => {
    const rows = [
      { ...zeroUsage, model: "claude-sonnet-4-6" },
      { ...zeroUsage, model: "gpt-5-codex" },
      { ...zeroUsage, model: "fictional-model-x" },
    ];
    expect(collectUnmappedModels(rows)).toEqual(["fictional-model-x"]);
  });
});
