import { describe, expect, it } from "vitest";
import { buildCodexConfig } from "../electron/lib/config.mjs";

describe("Codex config writer", () => {
  it("replaces the 9Router provider without disturbing unrelated sections", () => {
    const existing = `model = "old-model"
model_provider = "old-provider"

[model_providers."9router"]
name = "Old Router"
base_url = "http://localhost:9999/v1"
env_key = "NINEROUTER_API_KEY"

[mcp_servers.example]
command = "example"
`;

    const result = buildCodexConfig(existing, {
      model: "cx/gpt-5.6-sol",
      baseUrl: "http://localhost:20128/v1",
      catalogPath: "C:\\Users\\test\\.codex\\9router-model-catalog.json",
      helperCommand: "C:\\Program Files\\JSON Codex\\JSON Codex.exe",
    });

    expect(result).toContain('model = "cx/gpt-5.6-sol"');
    expect(result).toContain('model_provider = "9router"');
    expect(result).toContain('[model_providers."9router".auth]');
    expect(result).toContain('args = ["--json-codex-print-token"]');
    expect(result).not.toContain("NINEROUTER_API_KEY");
    expect(result).not.toContain("Old Router");
    expect(result).toContain("[mcp_servers.example]");
    expect(result).toContain('command = "example"');
  });

  it("is idempotent for the managed provider block", () => {
    const options = {
      model: "cx/gpt-6-sol",
      baseUrl: "https://router.example.com/v1",
      catalogPath: "/Users/test/.codex/9router-model-catalog.json",
      helperCommand: "/Applications/JSON Codex.app/Contents/MacOS/JSON Codex",
    };
    const first = buildCodexConfig("", options);
    const second = buildCodexConfig(first, options);

    expect(second.match(/JSON Codex managed provider/g)).toHaveLength(2);
    expect(second.match(/\[model_providers\."9router"\]/g)).toHaveLength(1);
  });

  it("maps managed Windows paths to macOS while preserving unrelated settings", () => {
    const windowsOptions = {
      model: "cx/example",
      baseUrl: "http://localhost:20128/v1",
      catalogPath: "C:\\Users\\test\\.codex\\9router-model-catalog.json",
      helperCommand: "C:\\Users\\test\\AppData\\Roaming\\JSON Codex\\print-token.cmd",
    };
    const existing = buildCodexConfig('approval_policy = "on-request"\n\n[mcp_servers.example]\ncommand = "example"\n', windowsOptions);
    const macOptions = {
      ...windowsOptions,
      catalogPath: "/Users/Nguyễn An/.codex/9router-model-catalog.json",
      helperCommand: "/Users/Nguyễn An/Library/Application Support/JSON Codex/print-token.sh",
      helperTimeoutMs: 30000,
    };
    const result = buildCodexConfig(existing, macOptions);
    expect(result).toContain(`model_catalog_json = ${JSON.stringify(macOptions.catalogPath)}`);
    expect(result).toContain(`command = ${JSON.stringify(macOptions.helperCommand)}`);
    expect(result).toContain("timeout_ms = 30000");
    expect(result).toContain('approval_policy = "on-request"');
    expect(result).toContain('[mcp_servers.example]\ncommand = "example"');
    expect(result).not.toContain("C:");
    expect(result).not.toContain("print-token.cmd");
    expect(buildCodexConfig(result, macOptions)).toBe(result);
  });

  it("escapes spaces, quotes and shell metacharacters as TOML data", () => {
    const helper = '/Users/O\'Brien/Library/Application Support/"JSON" $HOME `Codex`/print-token.sh';
    const result = buildCodexConfig("", {
      model: "cx/example",
      baseUrl: "https://router.example/v1",
      catalogPath: "/Users/O'Brien/.codex/catalog.json",
      helperCommand: helper,
    });
    const command = result.match(/^command = (.+)$/m)[1];
    expect(JSON.parse(command)).toBe(helper);
    expect(result).toContain("timeout_ms = 5000");
  });
});
