import { describe, expect, it } from "vitest";
import {
  AUTH_PROBE_MODEL,
  buildModelCatalog,
  filterCodexModels,
  modelsEndpoint,
  normalizeBaseUrl,
  responsesEndpoint,
} from "../electron/lib/models.mjs";

describe("9Router model handling", () => {
  it("accepts localhost HTTP and builds the models endpoint", () => {
    expect(normalizeBaseUrl("http://localhost:20128/v1/"))
      .toBe("http://localhost:20128/v1");
    expect(modelsEndpoint("http://localhost:20128/v1"))
      .toBe("http://localhost:20128/v1/models");
  });

  it("builds the responses endpoint used for the auth probe", () => {
    expect(responsesEndpoint("http://localhost:20128/v1/"))
      .toBe("http://localhost:20128/v1/responses");
  });

  it("uses a probe model that can never match a real alias", () => {
    const real = filterCodexModels({
      data: [{ id: "cx/gpt-5.6-sol", owned_by: "cx" }],
    });
    expect(real.some((model) => model.id === AUTH_PROBE_MODEL)).toBe(false);
    expect(AUTH_PROBE_MODEL.startsWith("cx/")).toBe(false);
  });

  it("rejects insecure remote URLs", () => {
    expect(() => normalizeBaseUrl("http://router.example.com/v1"))
      .toThrow(/HTTPS/);
  });

  it("keeps only unique cx models and removes every [1m] alias", () => {
    const models = filterCodexModels({
      data: [
        { id: "cx/gpt-5.6-sol", owned_by: "cx", context_length: 372000 },
        { id: "cx/gpt-5.6-sol", owned_by: "cx", context_length: 372000 },
        { id: "cx/gpt-5.6-sol[1m]", owned_by: "cx", context_length: 872000 },
        { id: "oc-prod/gpt-5.6-sol", owned_by: "oc-prod" },
      ],
    });

    expect(models.map((model) => model.id)).toEqual(["cx/gpt-5.6-sol"]);
  });

  it("generates catalog entries without [1m] models", () => {
    const models = filterCodexModels({
      data: [
        {
          id: "cx/gpt-6-sol",
          owned_by: "cx",
          context_length: 272000,
          max_completion_tokens: 128000,
          capabilities: { vision: true, search: true, tools: true, reasoning: true },
        },
      ],
    });
    const catalog = buildModelCatalog(models);

    expect(catalog.models).toHaveLength(1);
    expect(catalog.models[0].slug).toBe("cx/gpt-6-sol");
    expect(catalog.models[0].context_window).toBe(272000);
    expect(catalog.models[0].base_instructions).toMatch(/You are Codex/);
  });

  it("reuses an unprefixed Codex template for related 9Router aliases", () => {
    const models = filterCodexModels({
      data: [{
        id: "cx/gpt-5.6-sol-review",
        owned_by: "cx",
        capabilities: { reasoning: true },
      }],
    });
    const catalog = buildModelCatalog(models, [{
      models: [{
        slug: "gpt-5.6-sol",
        model_messages: { instructions_template: "Full Codex instructions" },
      }],
    }]);

    expect(catalog.models[0].model_messages.instructions_template)
      .toBe("Full Codex instructions");
    expect(catalog.models[0]).not.toHaveProperty("base_instructions");
  });
});
