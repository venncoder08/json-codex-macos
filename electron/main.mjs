import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell } from "electron";
import { execFile } from "node:child_process";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { buildCodexConfig, summarizeConfig } from "./lib/config.mjs";
import {
  PRINT_TOKEN_ARG,
  helperWrapperPath,
  writeHelperWrapper,
} from "./lib/credential-helper.mjs";
import { findCodexExecutable, resolveCodexHome } from "./lib/platform.mjs";
import {
  AUTH_PROBE_MODEL,
  buildModelCatalog,
  filterCodexModels,
  modelsEndpoint,
  normalizeBaseUrl,
  responsesEndpoint,
} from "./lib/models.mjs";

const execFileAsync = promisify(execFile);
const CREDENTIAL_FILENAME = "credential.bin";
const DEFAULT_BASE_URL = "http://localhost:20128/v1";
const ALLOWED_DOC_HOSTS = new Set(["learn.chatgpt.com", "developers.openai.com"]);

app.setName("JSON Codex");

// Electron's userData path is separate from Chromium's profile path. Honor the
// standard absolute-path override explicitly, including headless helper runs.
const userDataOverride = app.commandLine.getSwitchValue("user-data-dir");
if (userDataOverride && path.isAbsolute(userDataOverride)) {
  app.setPath("userData", userDataOverride);
}

const isCredentialHelper = process.argv.includes(PRINT_TOKEN_ARG);
if (isCredentialHelper && process.platform === "darwin") app.dock.hide();

function applyBlockedReason() {
  if (!app.isPackaged && process.env.JSON_CODEX_ALLOW_DEV_APPLY !== "1") {
    return "Apply chỉ được bật trong bản ứng dụng đã đóng gói.";
  }
  if (process.platform === "darwin" && app.isPackaged && !app.isInApplicationsFolder()) {
    return "Hãy chuyển JSON Codex vào Applications và mở lại trước khi Apply để credential helper có đường dẫn ổn định.";
  }
  return null;
}

function credentialPath() {
  return path.join(app.getPath("userData"), CREDENTIAL_FILENAME);
}

async function updateHelperWrapper() {
  return writeHelperWrapper({
    userData: app.getPath("userData"),
    executable: process.execPath,
    platform: process.platform,
    appPath: app.isPackaged ? undefined : app.getAppPath(),
  });
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function lockDownFile(filePath) {
  if (process.platform !== "win32") {
    await chmod(filePath, 0o600).catch(() => {});
  }
}

async function saveCredential(apiKey) {
  const key = String(apiKey ?? "").trim();
  if (!key) throw new Error("API key không được để trống.");
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Hệ điều hành chưa cung cấp kho mã hóa an toàn.");
  }

  const filePath = credentialPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  const encrypted = safeStorage.encryptString(key);
  const tempPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(tempPath, encrypted, { mode: 0o600 });
  await rename(tempPath, filePath);
  await lockDownFile(filePath);
}

async function readCredential() {
  const filePath = credentialPath();
  if (!(await pathExists(filePath))) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Không thể mở kho mã hóa của hệ điều hành.");
  }
  const encrypted = await readFile(filePath);
  return safeStorage.decryptString(encrypted);
}

async function runCredentialHelper() {
  try {
    const key = await readCredential();
    if (!key) throw new Error("Chưa lưu API key 9Router.");
    process.stdout.write(key, () => app.exit(0));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`, () => app.exit(1));
  }
}

function configPaths() {
  const home = resolveCodexHome();
  return {
    codexHome: home,
    configPath: path.join(home, "config.toml"),
    catalogPath: path.join(home, "9router-model-catalog.json"),
    backupRoot: path.join(home, "json-codex-backups"),
  };
}

function timestampId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function readTextIfPresent(filePath) {
  return (await pathExists(filePath)) ? readFile(filePath, "utf8") : "";
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function writeAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, content, { mode: 0o600 });
  await rename(tempPath, filePath);
  await lockDownFile(filePath);
}

async function createBackup(paths) {
  const backupDir = path.join(paths.backupRoot, timestampId());
  await mkdir(backupDir, { recursive: true });
  const manifest = {
    createdAt: new Date().toISOString(),
    configExisted: await pathExists(paths.configPath),
    catalogExisted: await pathExists(paths.catalogPath),
  };

  if (manifest.configExisted) {
    await copyFile(paths.configPath, path.join(backupDir, "config.toml"));
  }
  if (manifest.catalogExisted) {
    await copyFile(paths.catalogPath, path.join(backupDir, "9router-model-catalog.json"));
  }
  await writeFile(
    path.join(backupDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 },
  );
  return backupDir;
}

async function latestBackup(paths) {
  if (!(await pathExists(paths.backupRoot))) return null;
  const entries = await readdir(paths.backupRoot, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));
  return directories[0] ? path.join(paths.backupRoot, directories[0]) : null;
}

function parseTopLevelValue(text, key) {
  const beforeFirstTable = text.split(/^\s*\[/m, 1)[0];
  const match = beforeFirstTable.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, "m"));
  return match?.[1] ?? null;
}

function parseProviderValue(text, key) {
  const lines = text.split(/\r?\n/);
  let insideProvider = false;
  for (const line of lines) {
    const section = line.match(/^\s*\[([^\]]+)]/);
    if (section) {
      const normalized = section[1].replace(/["']/g, "").replace(/\s+/g, "").toLowerCase();
      insideProvider = normalized === "model_providers.9router";
      continue;
    }
    if (!insideProvider) continue;
    const match = line.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`));
    if (match) return match[1];
  }
  return null;
}

async function codexVersion() {
  const installation = await findCodexExecutable();
  if (!installation) return { installed: false, executable: null, version: null };
  const { executable, env } = installation;
  try {
    const { stdout, stderr } = await execFileAsync(executable, ["--version"], { env, timeout: 5000 });
    return {
      installed: true,
      executable,
      version: (stdout || stderr).trim() || "Đã phát hiện",
    };
  } catch {
    return { installed: true, executable, version: "Không đọc được phiên bản" };
  }
}

// Plaintext keys left in the environment, auth.json or .env keep working for
// clients that read them directly, so a revoked key there still produces 401
// even after this app writes a valid credential helper. Report them so the
// mismatch is visible instead of silent.
async function staleKeySources(paths) {
  const sources = [];

  if (String(process.env.OPENAI_API_KEY ?? "").trim()) {
    sources.push("Biến môi trường OPENAI_API_KEY");
  }
  if (String(process.env.NINEROUTER_API_KEY ?? "").trim()) {
    sources.push("Biến môi trường NINEROUTER_API_KEY");
  }

  const authPath = path.join(paths.codexHome, "auth.json");
  const auth = await readJsonIfPresent(authPath);
  if (auth && String(auth.OPENAI_API_KEY ?? "").trim()) {
    sources.push(authPath);
  }

  const envPath = path.join(paths.codexHome, ".env");
  const envText = await readTextIfPresent(envPath);
  if (/^\s*(?:OPENAI_API_KEY|NINEROUTER_API_KEY)\s*=\s*\S/m.test(envText)) {
    sources.push(envPath);
  }

  return sources;
}

async function currentState() {
  const paths = configPaths();
  const config = await readTextIfPresent(paths.configPath);
  return {
    staleKeySources: await staleKeySources(paths),
    ...paths,
    platform: process.platform,
    packaged: app.isPackaged,
    canApply: applyBlockedReason() === null,
    applyBlockedReason: applyBlockedReason(),
    helperCommand: helperCommand(),
    keyStored: await pathExists(credentialPath()),
    currentModel: parseTopLevelValue(config, "model"),
    currentProvider: parseTopLevelValue(config, "model_provider"),
    baseUrl: parseProviderValue(config, "base_url") ?? DEFAULT_BASE_URL,
    legacyEnvKeyConfigured: /\benv_key\s*=\s*["']NINEROUTER_API_KEY["']/.test(config),
    codex: await codexVersion(),
    latestBackup: await latestBackup(paths),
  };
}

async function resolveKey(inputKey) {
  const typed = String(inputKey ?? "").trim();
  if (typed) return typed;
  const stored = await readCredential();
  if (!stored) throw new Error("Hãy nhập API key 9Router.");
  return stored;
}

async function fetchModels(baseUrl, apiKey) {
  const endpoint = modelsEndpoint(baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`9Router trả về HTTP ${response.status}.`);
    }
    const payload = await response.json();
    const models = filterCodexModels(payload);
    if (!models.length) {
      throw new Error("Không tìm thấy model Codex hợp lệ sau khi loại bỏ [1m].");
    }
    return models;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Kết nối 9Router đã hết thời gian chờ.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Proves the key is actually accepted. 9Router checks auth before it resolves
// the model, so an invalid model id returns 401 for a bad key and 404 for a
// good one; neither path runs inference, so this costs no tokens.
async function verifyKey(baseUrl, apiKey) {
  const endpoint = responsesEndpoint(baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: AUTH_PROBE_MODEL, input: "ping" }),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "9Router từ chối API key này (HTTP 401). Key sai, đã bị thu hồi, hoặc hết hạn.",
      );
    }
    return true;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Kết nối 9Router đã hết thời gian chờ khi xác thực key.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function validateSelection(model, models) {
  if (String(model).toLowerCase().includes("[1m]")) {
    throw new Error("Model [1m] đã bị loại khỏi ứng dụng.");
  }
  if (!models.some((entry) => entry.id === model)) {
    throw new Error("Model được chọn không nằm trong danh sách vừa fetch.");
  }
}

// The stable wrapper remains in userData across application bundle upgrades.
function helperCommand() {
  return helperWrapperPath(app.getPath("userData"));
}

async function prepareConfiguration(input) {
  const paths = configPaths();
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const models = Array.isArray(input.models) ? input.models : [];
  validateSelection(input.model, models);
  const existingConfig = await readTextIfPresent(paths.configPath);
  const options = {
    model: input.model,
    baseUrl,
    catalogPath: paths.catalogPath,
    helperCommand: helperCommand(),
    helperTimeoutMs: process.platform === "darwin" ? 30000 : 5000,
  };
  return {
    paths,
    baseUrl,
    models,
    existingConfig,
    options,
    nextConfig: buildCodexConfig(existingConfig, options),
  };
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1260,
    height: 820,
    minWidth: 940,
    minHeight: 680,
    backgroundColor: "#f3efe4",
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => window.show());
  if (!app.isPackaged && process.env.JSON_CODEX_CAPTURE_PATH) {
    window.webContents.once("did-finish-load", async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
      const image = await window.webContents.capturePage();
      await writeFile(process.env.JSON_CODEX_CAPTURE_PATH, image.toPNG());
      app.quit();
    });
  }
  window.loadFile(path.join(import.meta.dirname, "..", "dist", "index.html"));
}

function installApplicationMenu() {
  if (process.platform !== "darwin") return;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "appMenu" },
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ]));
}

function prepareMacInstallation() {
  if (process.platform !== "darwin" || !app.isPackaged || app.isInApplicationsFolder()) {
    return false;
  }
  const choice = dialog.showMessageBoxSync({
    type: "question",
    buttons: ["Chuyển vào Applications", "Để sau"],
    defaultId: 0,
    cancelId: 1,
    message: "Cài JSON Codex vào Applications?",
    detail: "Ứng dụng cần đường dẫn cố định để Codex đọc credential helper sau khi tháo DMG hoặc khởi động lại. Apply sẽ được bật khi mở ứng dụng từ Applications.",
  });
  if (choice !== 0) return false;
  try {
    return app.moveToApplicationsFolder({
      conflictHandler: () => dialog.showMessageBoxSync({
        type: "question",
        buttons: ["Hủy", "Tiếp tục"],
        defaultId: 0,
        cancelId: 0,
        message: "JSON Codex đã có trong Applications.",
        detail: "Tiếp tục sẽ thay thế bản đã cài, hoặc chuyển sang bản đang chạy. API key đã lưu được giữ trong kho mã hóa của hệ điều hành.",
      }) === 1,
    });
  } catch (error) {
    dialog.showMessageBoxSync({
      type: "error",
      message: "Không thể chuyển JSON Codex vào Applications.",
      detail: `${error instanceof Error ? error.message : String(error)}\nBạn có thể kéo ứng dụng vào Applications rồi mở lại.`,
    });
    return false;
  }
}

function registerHandlers() {
  ipcMain.handle("state:get", () => currentState());

  ipcMain.handle("models:fetch", async (_event, input) => {
    const baseUrl = normalizeBaseUrl(input?.baseUrl);
    const apiKey = await resolveKey(input?.apiKey);
    await verifyKey(baseUrl, apiKey);
    return {
      baseUrl,
      models: await fetchModels(baseUrl, apiKey),
    };
  });

  ipcMain.handle("config:preview", async (_event, input) => {
    const prepared = await prepareConfiguration(input);
    return {
      summary: summarizeConfig(prepared.options),
      configPath: prepared.paths.configPath,
      legacyEnvKeyConfigured: /\benv_key\s*=/.test(prepared.existingConfig),
    };
  });

  ipcMain.handle("config:apply", async (_event, input) => {
    const blockedReason = applyBlockedReason();
    if (blockedReason) throw new Error(blockedReason);
    const prepared = await prepareConfiguration(input);
    const apiKey = await resolveKey(input?.apiKey);
    // Never write config for a key the server rejects; that is what made the
    // app report success while Codex kept getting 401.
    await verifyKey(prepared.baseUrl, apiKey);
    await saveCredential(apiKey);
    await updateHelperWrapper();

    const templates = [
      await readJsonIfPresent(prepared.paths.catalogPath),
      await readJsonIfPresent(path.join(prepared.paths.codexHome, "models_cache.json")),
    ].filter(Boolean);
    const catalog = buildModelCatalog(prepared.models, templates);
    const backupDir = await createBackup(prepared.paths);

    await writeAtomic(
      prepared.paths.catalogPath,
      `${JSON.stringify(catalog, null, 2)}\n`,
    );
    await writeAtomic(prepared.paths.configPath, prepared.nextConfig);

    return {
      ok: true,
      backupDir,
      modelCount: catalog.models.length,
      state: await currentState(),
    };
  });

  ipcMain.handle("config:rollback", async () => {
    const paths = configPaths();
    const backupDir = await latestBackup(paths);
    if (!backupDir) throw new Error("Không tìm thấy bản backup để phục hồi.");
    const manifest = await readJsonIfPresent(path.join(backupDir, "manifest.json"));
    if (manifest?.configExisted) {
      await copyFile(path.join(backupDir, "config.toml"), paths.configPath);
    } else {
      await rm(paths.configPath, { force: true });
    }
    if (manifest?.catalogExisted) {
      await copyFile(
        path.join(backupDir, "9router-model-catalog.json"),
        paths.catalogPath,
      );
    } else {
      await rm(paths.catalogPath, { force: true });
    }
    return { ok: true, backupDir, state: await currentState() };
  });

  ipcMain.handle("docs:open", async (_event, rawUrl) => {
    const url = new URL(String(rawUrl));
    if (url.protocol !== "https:" || !ALLOWED_DOC_HOSTS.has(url.hostname)) {
      throw new Error("Chỉ được mở tài liệu OpenAI chính thức.");
    }
    await shell.openExternal(url.toString());
    return true;
  });
}

if (isCredentialHelper) {
  app.whenReady().then(runCredentialHelper);
} else {
  app.whenReady().then(async () => {
    // Electron quits and relaunches after a successful move. Never write a
    // helper pointing to a DMG or randomized App Translocation mount.
    if (prepareMacInstallation()) return;
    // Keep the wrapper in sync with the current install path; a reinstall to a
    // different directory would otherwise leave config.toml pointing at a
    // wrapper that invokes a stale executable.
    if (applyBlockedReason() === null) await updateHelperWrapper().catch(() => {});
    installApplicationMenu();
    registerHandlers();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
