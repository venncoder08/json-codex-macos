const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function normalizeBaseUrl(rawUrl) {
  const value = String(rawUrl ?? "").trim();
  if (!value) {
    throw new Error("Hãy nhập URL của 9Router.");
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("URL 9Router không hợp lệ.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("9Router chỉ hỗ trợ URL HTTP hoặc HTTPS.");
  }
  if (parsed.protocol === "http:" && !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error("URL từ xa phải dùng HTTPS. HTTP chỉ được phép với localhost.");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("URL không được chứa tài khoản, query hoặc fragment.");
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/v1";
  return parsed.toString().replace(/\/$/, "");
}

export function modelsEndpoint(baseUrl) {
  return `${normalizeBaseUrl(baseUrl)}/models`;
}

export function responsesEndpoint(baseUrl) {
  return `${normalizeBaseUrl(baseUrl)}/responses`;
}

// 9Router answers /models without checking the Authorization header, so a
// successful fetch proves nothing about the key. /responses rejects a bad key
// with 401 before it resolves the model, which lets us probe the credential
// using a deliberately invalid model id and spend no tokens.
export const AUTH_PROBE_MODEL = "__json_codex_auth_probe__";

function numberOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export function filterCodexModels(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const seen = new Set();

  return rows
    .filter((row) => {
      const id = typeof row?.id === "string" ? row.id.trim() : "";
      const isCodexAlias = row?.owned_by === "cx" || id.startsWith("cx/");
      return id && isCodexAlias && !id.toLowerCase().includes("[1m]");
    })
    .map((row) => {
      const capabilities = row.capabilities && typeof row.capabilities === "object"
        ? row.capabilities
        : {};
      return {
        id: row.id.trim(),
        ownedBy: row.owned_by ?? "cx",
        contextLength: numberOrNull(row.context_length ?? capabilities.contextWindow),
        maxCompletionTokens: numberOrNull(
          row.max_completion_tokens ?? capabilities.maxOutput,
        ),
        capabilities: {
          vision: Boolean(capabilities.vision),
          search: Boolean(capabilities.search),
          tools: capabilities.tools !== false,
          reasoning: Boolean(capabilities.reasoning),
        },
      };
    })
    .filter((model) => {
      if (seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    })
    .sort((a, b) => a.id.localeCompare(b.id, "en"));
}

export function displayNameForModel(id) {
  return id
    .replace(/^cx\//, "")
    .split("-")
    .map((part) => {
      if (/^gpt$/i.test(part)) return "GPT";
      if (/^\d+(\.\d+)*$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("-");
}

const REASONING_LEVELS = [
  { effort: "low", description: "Fast responses with lighter reasoning" },
  { effort: "medium", description: "Balanced reasoning for everyday work" },
  { effort: "high", description: "Deeper reasoning for complex tasks" },
  { effort: "xhigh", description: "Extra reasoning depth for difficult tasks" },
];

function findTemplate(model, templates) {
  const baseSlug = model.id.replace(/^cx\//, "");
  const normalizedSlug = (entry) => String(entry?.slug ?? "").replace(/^cx\//, "");
  return templates.find((entry) => normalizedSlug(entry) === baseSlug)
    ?? templates.find((entry) => {
      const slug = normalizedSlug(entry);
      if (model.id.includes("gpt-5.6")) return slug === "gpt-5.6-sol";
      if (model.id.includes("gpt-6")) return slug === "gpt-6-astra";
      if (model.id.includes("gpt-5.5")) return slug === "gpt-5.5";
      return false;
    })
    ?? null;
}

function genericCatalogEntry(model, priority) {
  const reasoningLevels = model.capabilities.reasoning ? REASONING_LEVELS : [];
  return {
    slug: model.id,
    display_name: displayNameForModel(model.id),
    description: "9Router model discovered from the OpenAI-compatible models endpoint.",
    base_instructions: "You are Codex, a coding agent. Work with the user to complete software engineering tasks safely, accurately, and concisely.",
    default_reasoning_level: model.capabilities.reasoning ? "medium" : "low",
    supported_reasoning_levels: reasoningLevels,
    shell_type: "unified_exec",
    visibility: "list",
    supported_in_api: true,
    priority,
    additional_speed_tiers: [],
    service_tiers: [],
    availability_nux: null,
    upgrade: null,
    include_skills_usage_instructions: false,
    include_plugin_usage_instructions: true,
    include_apps_usage_instructions: true,
    default_reasoning_summary: "none",
    support_verbosity: model.capabilities.reasoning,
    default_verbosity: "low",
    apply_patch_tool_type: "freeform",
    web_search_tool_type: model.capabilities.search ? "text_and_image" : "text",
    truncation_policy: { mode: "tokens", limit: 10000 },
    supports_image_detail_original: model.capabilities.vision,
    context_window: model.contextLength ?? 200000,
    max_context_window: model.contextLength ?? 200000,
    effective_context_window_percent: 95,
    experimental_supported_tools: [],
    input_modalities: model.capabilities.vision ? ["text", "image"] : ["text"],
    supports_search_tool: model.capabilities.search,
    use_responses_lite: false,
    node_repl_auto_review_required: false,
    node_repl_disabled: false,
  };
}

export function buildModelCatalog(models, templateCatalogs = []) {
  const templates = templateCatalogs.flatMap((catalog) =>
    Array.isArray(catalog?.models) ? catalog.models : [],
  );

  return {
    models: models.map((model, index) => {
      const template = findTemplate(model, templates);
      const generated = genericCatalogEntry(model, models.length - index);
      if (!template) return generated;

      const merged = {
        ...template,
        ...generated,
        slug: model.id,
        display_name: displayNameForModel(model.id),
        upgrade: null,
        context_window: model.contextLength ?? template.context_window ?? 200000,
        max_context_window: Math.max(
          model.contextLength ?? 0,
          template.max_context_window ?? template.context_window ?? 200000,
        ),
        input_modalities: model.capabilities.vision ? ["text", "image"] : ["text"],
        supports_search_tool: model.capabilities.search,
      };

      if (template.model_messages?.instructions_template) {
        delete merged.base_instructions;
      }
      return merged;
    }),
  };
}
