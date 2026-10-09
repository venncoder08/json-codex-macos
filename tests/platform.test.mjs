import { afterEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { findCodexExecutable, resolveCodexHome } from "../electron/lib/platform.mjs";

const mac = { platform: "darwin", home: "/Users/Nguyễn Test", cwd: "/Users/Nguyễn Test/Projects" };
const noShell = async () => { throw new Error("Shell unavailable"); };
const shellResult = (value) => ({ stdout: `Welcome to my shell\n\0JSON_CODEX_LOGIN_PATH\0${value}\n\0banner` });

describe("Codex home mapping", () => {
  it.each([undefined, "", "  "])("uses the macOS home for an empty override (%s)", (CODEX_HOME) => {
    expect(resolveCodexHome({ ...mac, env: { CODEX_HOME } })).toBe("/Users/Nguyễn Test/.codex");
  });

  it.each([
    ["~/Codex Hồ sơ", "/Users/Nguyễn Test/Codex Hồ sơ"],
    ["~", "/Users/Nguyễn Test"],
    ["./custom", "/Users/Nguyễn Test/Projects/custom"],
    ["../custom", "/Users/Nguyễn Test/custom"],
    ["/Volumes/External Drive/Codex", "/Volumes/External Drive/Codex"],
    ["/Users/test/ spaces ", "/Users/test/ spaces "],
  ])("resolves %s without losing spaces or Unicode", (CODEX_HOME, expected) => {
    expect(resolveCodexHome({ ...mac, env: { CODEX_HOME } })).toBe(expected);
  });

  it("keeps Windows path rules when tests run on another OS", () => {
    expect(resolveCodexHome({ platform: "win32", home: "C:\\Users\\User", cwd: "D:\\Work", env: { CODEX_HOME: "..\\Codex Data" } }))
      .toBe("D:\\Codex Data");
    expect(resolveCodexHome({ platform: "win32", home: "C:\\Users\\User", cwd: "D:\\Work", env: {} }))
      .toBe("C:\\Users\\User\\.codex");
  });

  it.each(["C:\\Users\\ACER\\.codex", "D:/Codex", "\\\\server\\share"])("rejects an unmapped Windows override on macOS: %s", (CODEX_HOME) => {
    expect(() => resolveCodexHome({ ...mac, env: { CODEX_HOME } })).toThrow("đường dẫn Windows");
  });
});

describe("Codex discovery", () => {
  it("prefers the inherited PATH and retains shell PATH for npm's node", async () => {
    const runner = vi.fn().mockResolvedValue(shellResult("/Users/Nguyễn Test/.nvm/versions/node/v24/bin:/usr/bin"));
    const result = await findCodexExecutable({ ...mac,
      env: { PATH: "/custom bin:/usr/bin", SHELL: "/bin/zsh", CODEX_HOME: "/unchanged" }, runner,
      probe: async (file) => file === "/custom bin/codex" || file.endsWith("v24/bin/codex"),
    });
    expect(result.executable).toBe("/custom bin/codex");
    expect(result.env.PATH.split(":")).toContain("/Users/Nguyễn Test/.nvm/versions/node/v24/bin");
    expect(result.env.CODEX_HOME).toBe("/unchanged");
    expect(runner.mock.calls[0][0]).toBe("/bin/zsh");
    expect(runner.mock.calls[0][2]).toMatchObject({ timeout: 2500, maxBuffer: 65536, killSignal: "SIGKILL" });
  });

  it.each(["/opt/homebrew/bin/codex", "/usr/local/bin/codex", "/Users/Nguyễn Test/.local/bin/codex", "/Users/Nguyễn Test/.npm-global/bin/codex"])(
    "finds known install %s with Finder's minimal environment", async (executable) => {
      const result = await findCodexExecutable({ ...mac, env: { PATH: "/usr/bin:/bin" }, runner: noShell,
        probe: async (file) => file === executable,
      });
      expect(result.executable).toBe(executable);
      expect(result.env.PATH.split(":")).toContain(path.posix.dirname(executable));
    },
  );

  it("resolves shell-managed installs from framed output despite startup banners", async () => {
    const executable = "/Users/Nguyễn Test/.local/share/mise/shims/codex";
    const result = await findCodexExecutable({ ...mac, env: {},
      runner: async () => shellResult(path.posix.dirname(executable)),
      probe: async (file) => file === executable,
    });
    expect(result.executable).toBe(executable);
    expect(result.env.PATH).not.toContain("Welcome");
  });

  it("never interprets user paths as shell code", async () => {
    const dangerousHome = "/Users/quote' $(touch sentinel)";
    const runner = vi.fn().mockResolvedValue(shellResult("/usr/bin"));
    await findCodexExecutable({ platform: "darwin", home: dangerousHome,
      env: { SHELL: "/opt/shell folder/zsh", PATH: "" }, runner, probe: async () => false,
    });
    expect(runner.mock.calls[0][0]).toBe("/opt/shell folder/zsh");
    expect(runner.mock.calls[0][1][1]).not.toContain(dangerousHome);
    expect(runner.mock.calls[0][2].env.HOME).toBe(dangerousHome);
  });

  it("ignores empty and relative PATH entries and rejects unsupported shell commands", async () => {
    const probe = vi.fn().mockResolvedValue(false);
    const runner = vi.fn();
    expect(await findCodexExecutable({ ...mac, env: { PATH: ":.:relative:/absolute:", SHELL: "zsh; bad" }, probe, runner })).toBeNull();
    expect(runner).not.toHaveBeenCalled();
    expect(probe.mock.calls.map(([file]) => file)).toContain("/absolute/codex");
    expect(probe.mock.calls.every(([file]) => path.posix.isAbsolute(file))).toBe(true);
    expect(probe.mock.calls.map(([file]) => file)).not.toContain("codex");
  });

  it("handles unframed shell output and shell timeout failures", async () => {
    for (const runner of [noShell, async () => ({ stdout: "not a protocol response" })]) {
      expect(await findCodexExecutable({ ...mac, env: {}, runner, probe: async () => false })).toBeNull();
    }
  });

  it("maps Windows PATH case and versioned desktop installation without a POSIX shell", async () => {
    const runner = vi.fn();
    const executable = "C:\\Local\\OpenAI\\Codex\\bin\\1.2.3\\codex.exe";
    const result = await findCodexExecutable({ platform: "win32", home: "C:\\Users\\User",
      env: { Path: '"C:\\Programs With Spaces";C:\\Windows', LOCALAPPDATA: "C:\\Local" }, runner,
      probe: async (file) => file === executable || file === "C:\\Programs With Spaces\\codex.cmd",
      readDirectory: async () => [{ name: "1.2.3", isDirectory: () => true }],
    });
    expect(result.executable).toBe(executable);
    expect(result.env.Path).toBe("C:\\Programs With Spaces;C:\\Windows");
    expect(result.env.PATH).toBeUndefined();
    expect(runner).not.toHaveBeenCalled();
  });
});

describe("filesystem executable validation", () => {
  const temporary = [];
  afterEach(async () => { await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

  it("accepts a real executable file and rejects a directory named codex", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "json-codex-platform-"));
    temporary.push(directory);
    const binaryDir = path.join(directory, "User Nguyễn bin");
    await mkdir(binaryDir);
    const executable = path.join(binaryDir, process.platform === "win32" ? "codex.exe" : "codex");
    await mkdir(executable);
    const options = { platform: process.platform, home: directory, env: { PATH: binaryDir }, runner: noShell };
    expect((await findCodexExecutable(options))?.executable).not.toBe(executable);
    await rm(executable, { recursive: true });
    await writeFile(executable, "#!/bin/sh\nprintf 'codex 1.0'\n", { mode: 0o700 });
    expect((await findCodexExecutable(options)).executable).toBe(executable);
    if (process.platform !== "win32") {
      await chmod(executable, 0o600);
      expect((await findCodexExecutable(options))?.executable).not.toBe(executable);
    }
  });
});
