import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ ready: null, handlers: new Map(), events: new Map() }));
const electron = vi.hoisted(() => ({
  app: {
    setName: vi.fn(), setPath: vi.fn(), getPath: vi.fn(), getAppPath: vi.fn(),
    commandLine: { getSwitchValue: vi.fn() },
    isPackaged: true, isInApplicationsFolder: vi.fn(), moveToApplicationsFolder: vi.fn(),
    dock: { hide: vi.fn() }, exit: vi.fn(), quit: vi.fn(),
    whenReady: vi.fn(() => ({ then: (callback) => { runtime.ready = callback; } })),
    on: vi.fn((name, callback) => runtime.events.set(name, callback)),
  },
  BrowserWindow: Object.assign(vi.fn(function () {
    return { once: vi.fn(), loadFile: vi.fn(), show: vi.fn(), webContents: { once: vi.fn() } };
  }), { getAllWindows: vi.fn() }),
  dialog: { showMessageBoxSync: vi.fn() },
  ipcMain: { handle: vi.fn((name, callback) => runtime.handlers.set(name, callback)) },
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn((template) => template) },
  safeStorage: { isEncryptionAvailable: vi.fn(), decryptString: vi.fn(), encryptString: vi.fn() },
  shell: { openExternal: vi.fn() },
}));
const files = vi.hoisted(() => Object.fromEntries([
  "access", "chmod", "copyFile", "mkdir", "readFile", "readdir", "rename", "rm", "writeFile",
].map((name) => [name, vi.fn()])));
vi.mock("electron", () => electron);
vi.mock("node:fs/promises", () => files);
vi.mock("../electron/lib/platform.mjs", () => ({
  findCodexExecutable: vi.fn(async () => null), resolveCodexHome: vi.fn(() => "/Users/test/.codex"),
}));
vi.mock("../electron/lib/credential-helper.mjs", async (importOriginal) => ({
  ...await importOriginal(), writeHelperWrapper: vi.fn(async () => "/mock/print-token.sh"),
}));

let stdout;
let stderr;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  runtime.ready = null;
  runtime.handlers.clear();
  runtime.events.clear();
  electron.app.isPackaged = true;
  electron.app.isInApplicationsFolder.mockReturnValue(true);
  electron.app.moveToApplicationsFolder.mockReturnValue(false);
  electron.app.getPath.mockReturnValue("/Users/test/Library/Application Support/json-codex");
  electron.app.getAppPath.mockReturnValue("/source/json-codex");
  electron.app.commandLine.getSwitchValue.mockReturnValue("");
  electron.BrowserWindow.getAllWindows.mockReturnValue([]);
  electron.dialog.showMessageBoxSync.mockReturnValue(1);
  electron.safeStorage.isEncryptionAvailable.mockReturnValue(true);
  electron.safeStorage.decryptString.mockReturnValue("sk-fake-token");
  files.access.mockRejectedValue(new Error("ENOENT"));
  files.readFile.mockResolvedValue(Buffer.from("encrypted-test-fixture"));
  stdout = vi.fn((_data, callback) => { callback?.(); return true; });
  stderr = vi.fn((_data, callback) => { callback?.(); return true; });
  vi.stubGlobal("process", {
    ...process, platform: "darwin", argv: ["/Applications/JSON Codex.app/Contents/MacOS/JSON Codex"],
    env: { ...process.env, JSON_CODEX_ALLOW_DEV_APPLY: undefined, JSON_CODEX_CAPTURE_PATH: undefined },
    stdout: { write: stdout }, stderr: { write: stderr },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("macOS main lifecycle", () => {
  it("waits for Electron readiness, refreshes the stable helper and installs native menu roles", async () => {
    const { writeHelperWrapper } = await import("../electron/lib/credential-helper.mjs");
    await import("../electron/main.mjs");
    expect(writeHelperWrapper).not.toHaveBeenCalled();
    expect(electron.BrowserWindow).not.toHaveBeenCalled();
    await runtime.ready();
    expect(writeHelperWrapper).toHaveBeenCalledWith(expect.objectContaining({
      userData: "/Users/test/Library/Application Support/json-codex", platform: "darwin",
    }));
    expect(electron.Menu.buildFromTemplate).toHaveBeenCalledWith(expect.arrayContaining([
      { role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" },
    ]));
    expect(electron.BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({ titleBarStyle: "hiddenInset" }));
    runtime.events.get("window-all-closed")();
    expect(electron.app.quit).not.toHaveBeenCalled();
    runtime.events.get("activate")();
    expect(electron.BrowserWindow).toHaveBeenCalledTimes(2);
  });

  it("blocks apply without touching credentials or wrappers after cancelling installation", async () => {
    electron.app.isInApplicationsFolder.mockReturnValue(false);
    const { writeHelperWrapper } = await import("../electron/lib/credential-helper.mjs");
    await import("../electron/main.mjs");
    await runtime.ready();
    expect(electron.app.moveToApplicationsFolder).not.toHaveBeenCalled();
    expect(writeHelperWrapper).not.toHaveBeenCalled();
    await expect(runtime.handlers.get("config:apply")({}, {})).rejects.toThrow("Applications");
    expect(files.writeFile).not.toHaveBeenCalled();
    expect(electron.safeStorage.encryptString).not.toHaveBeenCalled();
    const state = await runtime.handlers.get("state:get")();
    expect(state.canApply).toBe(false);
    expect(state.applyBlockedReason).toContain("Applications");
  });

  it("does not initialize the old GUI path when Electron moves and relaunches the app", async () => {
    electron.app.isInApplicationsFolder.mockReturnValue(false);
    electron.dialog.showMessageBoxSync.mockReturnValue(0);
    electron.app.moveToApplicationsFolder.mockReturnValue(true);
    const { writeHelperWrapper } = await import("../electron/lib/credential-helper.mjs");
    await import("../electron/main.mjs");
    await runtime.ready();
    expect(electron.app.moveToApplicationsFolder).toHaveBeenCalledOnce();
    expect(writeHelperWrapper).not.toHaveBeenCalled();
    expect(electron.BrowserWindow).not.toHaveBeenCalled();
    expect(runtime.handlers.size).toBe(0);
    const { conflictHandler } = electron.app.moveToApplicationsFolder.mock.calls[0][0];
    expect(conflictHandler("exists")).toBe(false);
  });

  it("keeps apply blocked if the OS refuses or cancels the move", async () => {
    electron.app.isInApplicationsFolder.mockReturnValue(false);
    electron.dialog.showMessageBoxSync.mockReturnValue(0);
    electron.app.moveToApplicationsFolder.mockReturnValue(false);
    await import("../electron/main.mjs");
    await runtime.ready();
    await expect(runtime.handlers.get("config:apply")({}, {})).rejects.toThrow("Applications");
  });

  it("reports a failed installation and still allows read-only UI use", async () => {
    electron.app.isInApplicationsFolder.mockReturnValue(false);
    electron.dialog.showMessageBoxSync.mockReturnValue(0);
    electron.app.moveToApplicationsFolder.mockImplementationOnce(() => { throw new Error("Permission denied"); });
    await import("../electron/main.mjs");
    await runtime.ready();
    expect(electron.dialog.showMessageBoxSync).toHaveBeenCalledWith(expect.objectContaining({
      type: "error", detail: expect.stringContaining("Permission denied"),
    }));
    expect(electron.BrowserWindow).toHaveBeenCalledOnce();
  });

  it("retains the development apply restriction and skips installation prompts", async () => {
    electron.app.isPackaged = false;
    electron.app.isInApplicationsFolder.mockReturnValue(false);
    await import("../electron/main.mjs");
    await runtime.ready();
    expect(electron.dialog.showMessageBoxSync).not.toHaveBeenCalled();
    await expect(runtime.handlers.get("config:apply")({}, {})).rejects.toThrow("đóng gói");
  });

  it("hides the helper Dock before ready and accesses Keychain only after ready", async () => {
    process.argv.push("--json-codex-print-token");
    files.access.mockResolvedValue(undefined);
    electron.app.isInApplicationsFolder.mockReturnValue(false);
    await import("../electron/main.mjs");
    expect(electron.app.dock.hide).toHaveBeenCalledOnce();
    expect(electron.safeStorage.isEncryptionAvailable).not.toHaveBeenCalled();
    await runtime.ready();
    expect(electron.safeStorage.decryptString).toHaveBeenCalledOnce();
    expect(stdout).toHaveBeenCalledWith("sk-fake-token", expect.any(Function));
    expect(electron.app.exit).toHaveBeenCalledWith(0);
    expect(electron.BrowserWindow).not.toHaveBeenCalled();
    expect(electron.dialog.showMessageBoxSync).not.toHaveBeenCalled();
    expect(electron.Menu.setApplicationMenu).not.toHaveBeenCalled();
  });

  it("honors an absolute userData override and fails a missing credential without touching Keychain", async () => {
    process.argv.push("--json-codex-print-token");
    // path.isAbsolute uses the host platform; this is also absolute on POSIX.
    electron.app.commandLine.getSwitchValue.mockReturnValue("/tmp/json-codex-isolated-profile");
    await import("../electron/main.mjs");
    expect(electron.app.setPath).toHaveBeenCalledWith("userData", "/tmp/json-codex-isolated-profile");
    await runtime.ready();
    expect(electron.safeStorage.isEncryptionAvailable).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("Chưa lưu API key"), expect.any(Function));
    expect(electron.app.exit).toHaveBeenCalledWith(1);
  });

  it("rejects relative profile overrides", async () => {
    electron.app.commandLine.getSwitchValue.mockReturnValue("relative/profile");
    await import("../electron/main.mjs");
    expect(electron.app.setPath).not.toHaveBeenCalled();
  });

  it("retains Windows window shutdown and skips the macOS menu/install flow", async () => {
    process.platform = "win32";
    await import("../electron/main.mjs");
    await runtime.ready();
    expect(electron.app.dock.hide).not.toHaveBeenCalled();
    expect(electron.dialog.showMessageBoxSync).not.toHaveBeenCalled();
    expect(electron.Menu.setApplicationMenu).not.toHaveBeenCalled();
    runtime.events.get("window-all-closed")();
    expect(electron.app.quit).toHaveBeenCalledOnce();
  });
});
