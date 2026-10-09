import "@fontsource-variable/manrope";
import "@fontsource-variable/jetbrains-mono";
import "./style.css";

interface ModelCapabilities {
  vision: boolean;
  search: boolean;
  tools: boolean;
  reasoning: boolean;
}

interface CodexModel {
  id: string;
  ownedBy: string;
  contextLength: number | null;
  maxCompletionTokens: number | null;
  capabilities: ModelCapabilities;
}

interface AppState {
  codexHome: string;
  configPath: string;
  catalogPath: string;
  platform: string;
  packaged: boolean;
  canApply: boolean;
  applyBlockedReason: string | null;
  keyStored: boolean;
  currentModel: string | null;
  currentProvider: string | null;
  baseUrl: string;
  legacyEnvKeyConfigured: boolean;
  staleKeySources: string[];
  latestBackup: string | null;
  codex: {
    installed: boolean;
    executable: string | null;
    version: string | null;
  };
}

interface ApplyInput {
  baseUrl: string;
  apiKey: string;
  model: string;
  models: CodexModel[];
}

interface JsonCodexApi {
  getState(): Promise<AppState>;
  fetchModels(input: { baseUrl: string; apiKey: string }): Promise<{
    baseUrl: string;
    models: CodexModel[];
  }>;
  previewConfig(input: ApplyInput): Promise<{
    summary: Record<string, string>;
    configPath: string;
    legacyEnvKeyConfigured: boolean;
  }>;
  applyConfig(input: ApplyInput): Promise<{
    ok: boolean;
    backupDir: string;
    modelCount: number;
    state: AppState;
  }>;
  rollback(): Promise<{ ok: boolean; backupDir: string; state: AppState }>;
  openDocumentation(url: string): Promise<boolean>;
}

declare global {
  interface Window {
    jsonCodex: JsonCodexApi;
  }
}

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Không tìm thấy app root.");
// Reserve native window controls immediately, before asynchronous CLI lookup.
if (navigator.userAgent.includes("Macintosh")) document.documentElement.dataset.platform = "darwin";

root.innerHTML = `
  <div class="mac-titlebar" aria-hidden="true"></div>
  <div class="app-shell">
    <aside class="rail">
      <div class="brand-lockup reveal" style="--delay: 0ms">
        <div class="brand-mark" aria-hidden="true">
          <span>{</span><span>/</span><span>}</span>
        </div>
        <div>
          <p class="eyebrow">ROUTER SETUP UTILITY</p>
          <h1>JSON<br />Codex</h1>
        </div>
      </div>

      <ol class="steps reveal" style="--delay: 80ms" aria-label="Quy trình cấu hình">
        <li class="active"><span>01</span><strong>Kết nối</strong></li>
        <li><span>02</span><strong>Fetch model</strong></li>
        <li><span>03</span><strong>Chọn model</strong></li>
        <li><span>04</span><strong>Kiểm tra</strong></li>
        <li><span>05</span><strong>Apply config</strong></li>
      </ol>

      <div class="rail-note reveal" style="--delay: 160ms">
        <div class="lock-dot"></div>
        <p>API key được mã hóa bởi hệ điều hành và không xuất hiện trong terminal.</p>
      </div>
    </aside>

    <main class="workspace">
      <header class="topbar reveal" style="--delay: 40ms">
        <div>
          <p class="eyebrow">CODEX + 9ROUTER</p>
          <h2>Thiết lập một lần.<br /><em>Dùng ở mọi terminal.</em></h2>
        </div>
        <div class="status-cluster">
          <span id="codex-status" class="status-pill neutral">Đang kiểm tra Codex...</span>
          <span id="key-status" class="status-pill neutral">Đang kiểm tra key...</span>
        </div>
      </header>

      <section class="dashboard-grid">
        <div class="primary-column">
          <article class="panel connection-panel reveal" style="--delay: 120ms">
            <div class="panel-heading">
              <div>
                <span class="section-number">01</span>
                <h3>Kết nối 9Router</h3>
              </div>
              <span class="micro-label">RESPONSES API</span>
            </div>

            <label class="field">
              <span>Base URL</span>
              <input id="base-url" type="url" value="http://localhost:20128/v1" spellcheck="false" />
              <small>HTTP chỉ được phép với localhost. URL từ xa phải dùng HTTPS.</small>
            </label>

            <label class="field">
              <span>9Router API key</span>
              <div class="secret-input">
                <input id="api-key" type="password" autocomplete="off" spellcheck="false" placeholder="Nhập key hoặc dùng key đã lưu" />
                <button id="toggle-key" class="icon-button" type="button" aria-label="Hiện API key">Hiện</button>
              </div>
              <small id="key-hint">Key chỉ được gửi tới tiến trình chính của ứng dụng.</small>
            </label>

            <button id="fetch-models" class="button button-dark" type="button">
              <span>Fetch Codex models</span>
              <span aria-hidden="true">↗</span>
            </button>
          </article>

          <article class="panel models-panel reveal" style="--delay: 200ms">
            <div class="panel-heading models-heading">
              <div>
                <span class="section-number">02—03</span>
                <h3>Model khả dụng</h3>
              </div>
              <div class="model-tools">
                <span id="model-count" class="count-badge">0 MODEL</span>
                <input id="model-filter" class="filter-input" type="search" placeholder="Lọc model..." />
              </div>
            </div>

            <div id="model-empty" class="empty-state">
              <div class="empty-orbit" aria-hidden="true"><span></span></div>
              <strong>Chưa fetch model</strong>
              <p>Nhập key rồi kết nối 9Router. Các alias chứa <code>[1m]</code> sẽ tự động bị loại.</p>
            </div>
            <div id="model-list" class="model-list" hidden></div>
          </article>
        </div>

        <aside class="secondary-column">
          <article class="panel preview-panel reveal" style="--delay: 160ms">
            <div class="panel-heading">
              <div>
                <span class="section-number">04</span>
                <h3>Config preview</h3>
              </div>
              <span class="micro-label">NO SECRET</span>
            </div>

            <dl class="config-list">
              <div><dt>Provider</dt><dd>9router</dd></div>
              <div><dt>Wire API</dt><dd>responses</dd></div>
              <div><dt>Model</dt><dd id="preview-model">Chưa chọn</dd></div>
              <div><dt>Auth</dt><dd id="auth-method">OS credential helper</dd></div>
              <div><dt>Catalog</dt><dd id="preview-catalog">Đang tải...</dd></div>
            </dl>

            <div class="path-box">
              <span>config.toml</span>
              <code id="config-path">Đang tải...</code>
            </div>

            <div id="mac-environment-hint" class="environment-hint" hidden>
              macOS dùng <code>~/.codex</code> mặc định. Finder không nhận <code>CODEX_HOME</code> từ <code>.zshrc</code>.
              Nếu đã đổi thư mục này trong Terminal, hãy mở ứng dụng từ Terminal với cùng biến môi trường và kiểm tra đường dẫn phía trên trước khi Apply.
            </div>

            <div id="legacy-warning" class="warning-box" hidden>
              Cấu hình cũ đang dùng <code>env_key</code>. Apply sẽ chuyển provider sang credential helper; file <code>.env</code> không bị xóa.
            </div>

            <div id="stale-warning" class="warning-box" hidden>
              <strong>Còn key dạng plaintext.</strong>
              <span id="stale-list"></span>
              Nếu key ở đó đã bị thu hồi, client nào đọc trực tiếp sẽ vẫn gặp lỗi 401 dù app đã cấu hình đúng. Hãy xóa chúng để mọi client dùng credential helper.
            </div>
          </article>

          <article class="panel apply-panel reveal" style="--delay: 240ms">
            <div class="apply-heading">
              <span class="section-number inverse">05</span>
              <div>
                <p class="eyebrow">READY TO WRITE</p>
                <h3>Apply Configuration</h3>
              </div>
            </div>
            <p>Ứng dụng backup config và catalog trước khi cập nhật. CLI và VS Code dùng chung cấu hình này.</p>
            <button id="apply-config" class="button button-accent" type="button" disabled>
              Apply &amp; secure key
            </button>
            <p id="apply-blocked-reason" class="apply-blocked-reason" hidden></p>
            <button id="rollback" class="text-button" type="button" disabled>Phục hồi backup mới nhất</button>
          </article>

          <article class="usage-card reveal" style="--delay: 320ms">
            <p class="eyebrow">SAU KHI APPLY</p>
            <div class="usage-line"><span>VS Code</span><code>/model</code></div>
            <div class="usage-line"><span>Terminal</span><code>codex</code></div>
            <div class="usage-line"><span>Model cụ thể</span><code id="usage-command">codex -m "..."</code></div>
            <button class="docs-link" data-docs="https://learn.chatgpt.com/docs/config-file/config-basic">OpenAI Docs ↗</button>
          </article>
        </aside>
      </section>
    </main>
  </div>

  <div id="toast" class="toast" role="status" aria-live="polite"></div>
`;

const elements = {
  baseUrl: document.querySelector<HTMLInputElement>("#base-url")!,
  apiKey: document.querySelector<HTMLInputElement>("#api-key")!,
  toggleKey: document.querySelector<HTMLButtonElement>("#toggle-key")!,
  fetchModels: document.querySelector<HTMLButtonElement>("#fetch-models")!,
  applyConfig: document.querySelector<HTMLButtonElement>("#apply-config")!,
  rollback: document.querySelector<HTMLButtonElement>("#rollback")!,
  modelFilter: document.querySelector<HTMLInputElement>("#model-filter")!,
  modelList: document.querySelector<HTMLDivElement>("#model-list")!,
  modelEmpty: document.querySelector<HTMLDivElement>("#model-empty")!,
  modelCount: document.querySelector<HTMLSpanElement>("#model-count")!,
  previewModel: document.querySelector<HTMLElement>("#preview-model")!,
  previewCatalog: document.querySelector<HTMLElement>("#preview-catalog")!,
  configPath: document.querySelector<HTMLElement>("#config-path")!,
  usageCommand: document.querySelector<HTMLElement>("#usage-command")!,
  codexStatus: document.querySelector<HTMLElement>("#codex-status")!,
  keyStatus: document.querySelector<HTMLElement>("#key-status")!,
  keyHint: document.querySelector<HTMLElement>("#key-hint")!,
  authMethod: document.querySelector<HTMLElement>("#auth-method")!,
  macEnvironmentHint: document.querySelector<HTMLElement>("#mac-environment-hint")!,
  applyBlockedReason: document.querySelector<HTMLElement>("#apply-blocked-reason")!,
  legacyWarning: document.querySelector<HTMLElement>("#legacy-warning")!,
  staleWarning: document.querySelector<HTMLElement>("#stale-warning")!,
  staleList: document.querySelector<HTMLElement>("#stale-list")!,
  toast: document.querySelector<HTMLElement>("#toast")!,
};

let appState: AppState | null = null;
let models: CodexModel[] = [];
let selectedModel = "";
let toastTimer: number | undefined;

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

function formatTokens(value: number | null): string {
  if (!value) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}M`;
  return `${Math.round(value / 1000)}K`;
}

function status(element: HTMLElement, text: string, tone: "neutral" | "good" | "warn") {
  element.textContent = text;
  element.className = `status-pill ${tone}`;
}

function showToast(message: string, tone: "good" | "error" = "good") {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = `toast visible ${tone}`;
  toastTimer = window.setTimeout(() => {
    elements.toast.className = "toast";
  }, 5000);
}

function setBusy(button: HTMLButtonElement, busy: boolean, label: string) {
  if (!button.dataset.label) button.dataset.label = button.textContent?.trim() ?? "";
  button.disabled = busy;
  button.classList.toggle("busy", busy);
  button.textContent = busy ? label : button.dataset.label;
}

function renderModels() {
  const query = elements.modelFilter.value.trim().toLowerCase();
  const visible = models.filter((model) => model.id.toLowerCase().includes(query));
  elements.modelCount.textContent = `${models.length} MODEL`;
  elements.modelEmpty.hidden = models.length > 0;
  elements.modelList.hidden = models.length === 0;

  elements.modelList.innerHTML = visible.map((model) => {
    const chips = [
      model.capabilities.reasoning ? "Reasoning" : null,
      model.capabilities.vision ? "Vision" : null,
      model.capabilities.search ? "Search" : null,
      model.capabilities.tools ? "Tools" : null,
    ].filter(Boolean);
    const checked = model.id === selectedModel;
    return `
      <label class="model-row ${checked ? "selected" : ""}">
        <input type="radio" name="model" value="${escapeHtml(model.id)}" ${checked ? "checked" : ""} />
        <span class="radio-mark" aria-hidden="true"></span>
        <span class="model-identity">
          <strong>${escapeHtml(model.id)}</strong>
          <small>${chips.map((chip) => `<span>${chip}</span>`).join("")}</small>
        </span>
        <span class="model-metric"><small>CONTEXT</small><strong>${formatTokens(model.contextLength)}</strong></span>
        <span class="model-metric"><small>OUTPUT</small><strong>${formatTokens(model.maxCompletionTokens)}</strong></span>
      </label>
    `;
  }).join("");

  elements.modelList.querySelectorAll<HTMLInputElement>('input[name="model"]').forEach((input) => {
    input.addEventListener("change", () => selectModel(input.value));
  });
}

function selectModel(model: string) {
  selectedModel = model;
  elements.previewModel.textContent = model;
  elements.usageCommand.textContent = `codex -m "${model}"`;
  elements.applyConfig.disabled = !selectedModel || models.length === 0 || !appState?.canApply;
  renderModels();
  void refreshPreview();
}

function applyPayload(): ApplyInput {
  return {
    baseUrl: elements.baseUrl.value,
    apiKey: elements.apiKey.value,
    model: selectedModel,
    models,
  };
}

async function refreshPreview() {
  if (!selectedModel || models.length === 0) return;
  try {
    const preview = await window.jsonCodex.previewConfig(applyPayload());
    elements.configPath.textContent = preview.configPath;
    elements.legacyWarning.hidden = !preview.legacyEnvKeyConfigured;
  } catch {
    // Validation errors are surfaced when the user fetches or applies.
  }
}

function renderStaleWarning(sources: string[] | undefined) {
  const list = sources ?? [];
  elements.staleWarning.hidden = list.length === 0;
  elements.staleList.innerHTML = list.length
    ? `<code>${list.map(escapeHtml).join("</code>, <code>")}</code>.`
    : "";
}

async function loadState() {
  appState = await window.jsonCodex.getState();
  const isMac = appState.platform === "darwin";
  document.documentElement.dataset.platform = appState.platform;
  elements.macEnvironmentHint.hidden = !isMac;
  elements.authMethod.textContent = isMac ? "macOS Keychain helper" : "OS credential helper";
  elements.baseUrl.value = appState.baseUrl || "http://localhost:20128/v1";
  elements.previewCatalog.textContent = appState.catalogPath;
  elements.configPath.textContent = appState.configPath;
  elements.legacyWarning.hidden = !appState.legacyEnvKeyConfigured;
  renderStaleWarning(appState.staleKeySources);
  elements.rollback.disabled = !appState.latestBackup;
  elements.applyConfig.title = appState.applyBlockedReason || "";
  elements.applyBlockedReason.textContent = appState.applyBlockedReason || "";
  elements.applyBlockedReason.hidden = !appState.applyBlockedReason;
  elements.applyConfig.disabled = !selectedModel || models.length === 0 || !appState.canApply;

  status(
    elements.codexStatus,
    appState.codex.installed ? appState.codex.version ?? "Codex detected" : "Codex chưa được phát hiện",
    appState.codex.installed ? "good" : "warn",
  );
  status(
    elements.keyStatus,
    appState.keyStored ? "Key đã được mã hóa" : "Chưa lưu key",
    appState.keyStored ? "good" : "neutral",
  );
  renderKeyHint();
}

function renderKeyHint() {
  const isMac = appState?.platform === "darwin";
  elements.keyHint.textContent = appState?.keyStored
    ? isMac
      ? "Để trống để dùng key đã mã hóa bằng macOS Keychain. macOS có thể yêu cầu cho phép truy cập Keychain."
      : "Để trống để dùng key đã lưu trong kho bảo mật của hệ điều hành."
    : isMac
      ? "Key được mã hóa bằng macOS Keychain khi Apply. macOS có thể yêu cầu cho phép truy cập Keychain."
      : "Key chỉ được gửi tới tiến trình chính của ứng dụng.";
}

elements.toggleKey.addEventListener("click", () => {
  const reveal = elements.apiKey.type === "password";
  elements.apiKey.type = reveal ? "text" : "password";
  elements.toggleKey.textContent = reveal ? "Ẩn" : "Hiện";
  elements.toggleKey.setAttribute("aria-label", reveal ? "Ẩn API key" : "Hiện API key");
});

elements.fetchModels.addEventListener("click", async () => {
  setBusy(elements.fetchModels, true, "Đang fetch...");
  try {
    const result = await window.jsonCodex.fetchModels({
      baseUrl: elements.baseUrl.value,
      apiKey: elements.apiKey.value,
    });
    elements.baseUrl.value = result.baseUrl;
    models = result.models;
    const preferred = appState?.currentModel && models.some((model) => model.id === appState?.currentModel)
      ? appState.currentModel
      : models.find((model) => model.id === "cx/gpt-5.6-sol")?.id ?? models[0]?.id ?? "";
    selectedModel = preferred;
    renderModels();
    selectModel(preferred);
    showToast(`Đã fetch ${models.length} model Codex; model [1m] đã bị loại.`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    setBusy(elements.fetchModels, false, "");
  }
});

elements.applyConfig.addEventListener("click", async () => {
  setBusy(elements.applyConfig, true, "Đang apply...");
  try {
    const result = await window.jsonCodex.applyConfig(applyPayload());
    appState = result.state;
    elements.apiKey.value = "";
    elements.apiKey.type = "password";
    elements.toggleKey.textContent = "Hiện";
    elements.rollback.disabled = false;
    elements.legacyWarning.hidden = true;
    renderStaleWarning(appState.staleKeySources);
    status(elements.keyStatus, "Key đã được mã hóa", "good");
    renderKeyHint();
    showToast(`Đã cấu hình ${result.modelCount} model. Backup: ${result.backupDir}`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    setBusy(elements.applyConfig, false, "");
    elements.applyConfig.disabled = !selectedModel || !appState?.canApply;
  }
});

elements.rollback.addEventListener("click", async () => {
  if (!window.confirm("Phục hồi config và catalog từ backup mới nhất?")) return;
  setBusy(elements.rollback, true, "Đang phục hồi...");
  try {
    const result = await window.jsonCodex.rollback();
    appState = result.state;
    showToast(`Đã phục hồi backup: ${result.backupDir}`);
    await loadState();
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    setBusy(elements.rollback, false, "");
  }
});

elements.modelFilter.addEventListener("input", renderModels);
elements.baseUrl.addEventListener("change", () => void refreshPreview());

document.querySelectorAll<HTMLButtonElement>("[data-docs]").forEach((button) => {
  button.addEventListener("click", () => {
    const url = button.dataset.docs;
    if (url) void window.jsonCodex.openDocumentation(url);
  });
});

loadState().catch((error) => {
  showToast(error instanceof Error ? error.message : String(error), "error");
});
