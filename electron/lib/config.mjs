const MANAGED_START = "# >>> JSON Codex managed provider >>>";
const MANAGED_END = "# <<< JSON Codex managed provider <<<";

function tomlString(value) {
  return JSON.stringify(String(value));
}

function stripManagedBlock(text) {
  const pattern = new RegExp(
    `(?:\\r?\\n)?${MANAGED_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${MANAGED_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\r?\\n)?`,
    "g",
  );
  return text.replace(pattern, "\n");
}

function normalizeSectionName(value) {
  return value.replace(/["']/g, "").replace(/\s+/g, "").toLowerCase();
}

function stripProviderSections(text) {
  const lines = text.split(/\r?\n/);
  const output = [];
  let skipping = false;

  for (const line of lines) {
    const match = line.match(/^\s*\[([^\]]+)]\s*(?:#.*)?$/);
    if (match) {
      const section = normalizeSectionName(match[1]);
      if (section === "model_providers.9router" || section.startsWith("model_providers.9router.")) {
        skipping = true;
        continue;
      }
      skipping = false;
    }

    if (!skipping) output.push(line);
  }

  return output.join("\n");
}

function setTopLevelKeys(text, entries) {
  const lines = text.split(/\r?\n/);

  for (const [key, value] of Object.entries(entries)) {
    const firstSection = lines.findIndex((line) => /^\s*\[/.test(line));
    const limit = firstSection === -1 ? lines.length : firstSection;
    const pattern = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`);
    const index = lines.slice(0, limit).findIndex((line) => pattern.test(line));
    const rendered = `${key} = ${tomlString(value)}`;
    if (index >= 0) lines[index] = rendered;
    else lines.splice(0, 0, rendered);
  }

  return lines.join("\n");
}

export function buildCodexConfig(existingText, options) {
  let next = String(existingText ?? "").replace(/^\uFEFF/, "");
  next = stripManagedBlock(next);
  next = stripProviderSections(next);
  next = setTopLevelKeys(next, {
    model_catalog_json: options.catalogPath,
    model_provider: "9router",
    model: options.model,
  });

  const providerBlock = [
    MANAGED_START,
    "[model_providers.\"9router\"]",
    'name = "9Router"',
    `base_url = ${tomlString(options.baseUrl)}`,
    'wire_api = "responses"',
    "",
    "[model_providers.\"9router\".auth]",
    `command = ${tomlString(options.helperCommand)}`,
    'args = ["--json-codex-print-token"]',
    `timeout_ms = ${options.helperTimeoutMs ?? 5000}`,
    "refresh_interval_ms = 300000",
    MANAGED_END,
  ].join("\n");

  return `${next.trimEnd()}\n\n${providerBlock}\n`;
}

export function summarizeConfig(options) {
  return {
    model: options.model,
    provider: "9router",
    baseUrl: options.baseUrl,
    catalogPath: options.catalogPath,
    helperCommand: options.helperCommand,
    auth: "OS-encrypted credential helper",
  };
}
