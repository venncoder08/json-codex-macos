import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  helperWrapperPath,
  helperWrapperScript,
  quotePosixArgument,
  writeHelperWrapper,
} from "../electron/lib/credential-helper.mjs";

const execFileAsync = promisify(execFile);
const directories = [];
const shell = process.platform === "win32"
  ? process.env.JSON_CODEX_TEST_SHELL || "C:/Program Files/Git/bin/bash.exe"
  : "/bin/sh";
const shellAvailable = existsSync(shell);
const shellPath = (value) => value.replaceAll("\\", "/");

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("credential helper mapping", () => {
  it("uses stable, platform-native paths under userData", () => {
    expect(helperWrapperPath("/Users/Linh/Library/Application Support/JSON Codex", "darwin"))
      .toBe("/Users/Linh/Library/Application Support/JSON Codex/print-token.sh");
    expect(helperWrapperPath("C:\\Users\\Linh\\AppData\\Roaming\\JSON Codex", "win32"))
      .toBe("C:\\Users\\Linh\\AppData\\Roaming\\JSON Codex\\print-token.cmd");
  });

  it("quotes spaces, apostrophes, dollar substitution and backticks literally", () => {
    expect(quotePosixArgument("/Applications/JSON Codex's $(whoami) `id`.app"))
      .toBe("'/Applications/JSON Codex'\\''s $(whoami) `id`.app'");
    expect(() => quotePosixArgument("bad\0path")).toThrow("NUL");
  });

  it("keeps the Windows command wrapper behavior", () => {
    const script = helperWrapperScript("C:\\Program Files\\JSON Codex.exe", { platform: "win32" });
    expect(script).toContain('`"C:\\Program Files\\JSON Codex.exe" --json-codex-print-token`');
    expect(script).toContain('<nul set /p "=%%T"');
    expect(script).toContain("\r\n");
  });

  it("includes the development app argument and explicit userData profile", () => {
    const script = helperWrapperScript("/Electron.app/Contents/MacOS/Electron", {
      platform: "darwin", appPath: "/Users/Linh/source app", userData: "/Users/Linh/test profile",
    });
    expect(script).toContain("'/Electron.app/Contents/MacOS/Electron' '/Users/Linh/source app' '--user-data-dir=/Users/Linh/test profile' '--json-codex-print-token'");
    expect(script).not.toContain("\r\n");
  });
});

describe.skipIf(!shellAvailable)("POSIX helper behavior", () => {
  async function fixture(body) {
    const directory = await mkdtemp(path.join(tmpdir(), "json-codex-helper-"));
    directories.push(directory);
    const executable = path.join(directory, "JSON Codex's $(touch SHOULD_NOT_EXIST) `whoami`.sh");
    await writeFile(executable, `#!/bin/sh\n${body}\n`, { mode: 0o700 });
    const wrapper = path.join(directory, "print token.sh");
    await writeFile(wrapper, helperWrapperScript(shellPath(executable), { platform: "darwin" }), { mode: 0o700 });
    return { directory, wrapper };
  }

  it("runs a quoted executable and emits only the token, without CRLF", async () => {
    const { directory, wrapper } = await fixture([
      '[ "$1" = "--json-codex-print-token" ] || exit 23',
      '[ -z "${ELECTRON_RUN_AS_NODE+x}" ] || exit 24',
      "printf '\\r\\n\\nsk-fake-$HOME-`id`-%%-quote\\r\\n'",
    ].join("\n"));
    const { stdout, stderr } = await execFileAsync(shell, [shellPath(wrapper)], {
      cwd: directory, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    expect(stdout).toBe("sk-fake-$HOME-`id`-%-quote");
    expect(stderr).toBe("");
    expect(existsSync(path.join(directory, "SHOULD_NOT_EXIST"))).toBe(false);
  });

  it("preserves executable failure and stderr without exposing partial stdout", async () => {
    const { wrapper } = await fixture("printf 'partial-secret'; printf 'Keychain unavailable\\n' >&2; exit 7");
    await expect(execFileAsync(shell, [shellPath(wrapper)])).rejects.toMatchObject({
      code: 7, stdout: "", stderr: "Keychain unavailable\n",
    });
  });

  it("fails for successful execution with empty or blank output", async () => {
    const { wrapper } = await fixture("printf '\\r\\n\\n'; exit 0");
    await expect(execFileAsync(shell, [shellPath(wrapper)])).rejects.toMatchObject({ code: 1, stdout: "" });
  });
});

it.skipIf(process.platform === "win32")("writes/replaces the macOS helper atomically with owner-only executable mode", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "json-codex-helper-mode-"));
  directories.push(directory);
  const wrapper = await writeHelperWrapper({ userData: directory, executable: "/Applications/First.app/Contents/MacOS/First", platform: "darwin" });
  await chmod(wrapper, 0o777);
  await writeHelperWrapper({ userData: directory, executable: "/Applications/Second.app/Contents/MacOS/Second", platform: "darwin" });
  expect((await stat(wrapper)).mode & 0o777).toBe(0o700);
  const text = await readFile(wrapper, "utf8");
  expect(text).toContain("Second.app");
  expect(text).not.toContain("First.app");
});
