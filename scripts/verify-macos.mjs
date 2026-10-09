import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

if (process.platform !== "darwin") {
  throw new Error("verify:mac must run on macOS against a built .app bundle.");
}

const bundle = path.resolve(process.argv[2] ?? "release/mac-universal/JSON Codex.app");
const expectedArch = process.argv[3] ?? "universal";
assert.ok(["universal", "arm64", "x64"].includes(expectedArch), "Unknown architecture");
const expected = expectedArch === "universal" ? ["arm64", "x86_64"]
  : [expectedArch === "x64" ? "x86_64" : "arm64"];

async function plistValue(bundlePath, key) {
  const { stdout } = await run("/usr/libexec/PlistBuddy", [
    "-c", `Print :${key}`, path.join(bundlePath, "Contents", "Info.plist"),
  ]);
  return stdout.trim();
}

async function executableIn(bundlePath) {
  return path.join(bundlePath, "Contents", "MacOS", await plistValue(bundlePath, "CFBundleExecutable"));
}

const executable = await executableIn(bundle);
await access(path.join(bundle, "Contents", "Resources", "app.asar"));
const minimum = await plistValue(bundle, "LSMinimumSystemVersion");
assert.match(minimum, /^\d+\.\d+(?:\.\d+)?$/, "Missing Electron minimum macOS version");

const frameworks = path.join(bundle, "Contents", "Frameworks");
const binaries = [executable, path.join(frameworks, "Electron Framework.framework", "Electron Framework")];
for (const entry of await readdir(frameworks)) {
  if (entry.endsWith(".app")) binaries.push(await executableIn(path.join(frameworks, entry)));
}
for (const binary of binaries) {
  const { stdout } = await run("/usr/bin/lipo", ["-archs", binary]);
  assert.deepEqual(stdout.trim().split(/\s+/).sort(), [...expected].sort(), `${binary}: architecture mismatch`);
}
await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle]);
console.log(`Verified ${binaries.length} Mach-O binaries (${expected.join(", ")}); minimum macOS ${minimum}.`);

const temporary = await mkdtemp(path.join(os.tmpdir(), "json-codex-mac-smoke-"));
const userData = path.join(temporary, "Application Support with spaces", "JSON Codex");
const codexHome = path.join(temporary, ".codex");
await mkdir(userData, { recursive: true });
await mkdir(codexHome, { recursive: true });
// Whitelist environment and explicitly override Electron userData. Never read
// the runner's app credentials or inherit any API/signing keys into smoke tests.
const env = {
  HOME: temporary,
  CFFIXED_USER_HOME: temporary,
  TMPDIR: temporary,
  CODEX_HOME: codexHome,
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  LANG: "en_US.UTF-8",
};
const userDataArg = `--user-data-dir=${userData}`;

async function checkEmptyCredential() {
  let failure;
  try {
    await run(executable, [userDataArg, "--json-codex-print-token"], {
      env, timeout: 20_000, maxBuffer: 256 * 1024,
    });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, "An empty credential store must fail");
  assert.equal(failure.killed, false, "Helper timed out");
  assert.equal(failure.code, 1, "Helper must return exit code 1");
  assert.equal(failure.stdout.trim(), "", "Empty store must not write a token");
  assert.match(failure.stderr, /Chưa lưu API key/, "Expected missing-credential diagnostic");
}

async function checkStartup() {
  const child = spawn(executable, [userDataArg], { env, stdio: "ignore" });
  let startupError;
  child.on("error", (error) => { startupError = error; });
  const closed = new Promise((resolve) => child.once("close", resolve));
  try {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    if (startupError) throw startupError;
    assert.equal(child.exitCode, null, "App exited during the startup smoke test");
    assert.equal(child.signalCode, null, "App crashed during the startup smoke test");
  } finally {
    child.kill("SIGTERM");
    const killTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    await closed;
    clearTimeout(killTimer);
  }
}

try {
  await checkEmptyCredential();
  await checkStartup();
  console.log("Isolated missing-credential helper and 5-second process startup smoke passed.");
  console.log("Keychain decryption, GUI interaction, and notarization still require release acceptance checks.");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
