import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const PATH_MARKER = "JSON_CODEX_LOGIN_PATH";

function pathsFor(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

// Read the application's environment only. Finder does not inherit exports
// from .zshrc; importing CODEX_HOME from a separate shell would silently write
// to a different location than the GUI's displayed configuration target.
export function resolveCodexHome({
  platform = process.platform,
  env = process.env,
  home = homedir(),
  cwd = process.cwd(),
} = {}) {
  const paths = pathsFor(platform);
  const override = env.CODEX_HOME;
  if (!override || !override.trim()) return paths.join(home, ".codex");
  if (platform !== "win32" && (/^[A-Za-z]:[\\/]/.test(override) || override.startsWith("\\\\"))) {
    throw new Error("CODEX_HOME đang dùng đường dẫn Windows. Hãy đổi sang đường dẫn macOS/POSIX, ví dụ ~/Codex.");
  }
  if (override === "~") return paths.normalize(home);
  if (override.startsWith("~/") || (platform === "win32" && override.startsWith("~\\"))) {
    return paths.resolve(home, override.slice(2));
  }
  return paths.resolve(cwd, override);
}

async function isExecutable(file, platform) {
  try {
    await access(file, platform === "win32" ? constants.F_OK : constants.X_OK);
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function pathDirectories(value, platform) {
  const paths = pathsFor(platform);
  return String(value ?? "").split(platform === "win32" ? ";" : ":")
    .map((entry) => platform === "win32" ? entry.replace(/^"(.*)"$/, "$1") : entry)
    // Do not turn an empty or relative PATH entry into an executable in the
    // directory from which Finder (or another launcher) started the app.
    .filter((entry) => paths.isAbsolute(entry));
}

async function loginPath(env, home, runner) {
  const loginShell = env.SHELL || "/bin/zsh";
  if (!path.posix.isAbsolute(loginShell)
    || !["zsh", "bash", "sh", "fish"].includes(path.posix.basename(loginShell))) return "";
  try {
    // A constant command, never interpolated shell paths or user values.
    // Markers exclude banners printed by user startup files from the result.
    const { stdout } = await runner(loginShell, ["-ilc",
      `printf '\\0${PATH_MARKER}\\0'; /usr/bin/printenv PATH; printf '\\0'`,
    ], { env: { ...env, HOME: home }, timeout: 2500, killSignal: "SIGKILL", maxBuffer: 65536, windowsHide: true });
    const marker = `\0${PATH_MARKER}\0`;
    const start = stdout.indexOf(marker);
    if (start < 0) return "";
    const end = stdout.indexOf("\0", start + marker.length);
    if (end < 0) return "";
    return stdout.slice(start + marker.length, end).replace(/\r?\n$/, "");
  } catch {
    return "";
  }
}

/** Discover the CLI and its process environment (needed by npm's env node). */
export async function findCodexExecutable({
  platform = process.platform,
  env = process.env,
  home = homedir(),
  probe = isExecutable,
  runner = runFile,
  readDirectory = readdir,
} = {}) {
  const paths = pathsFor(platform);
  const pathKey = Object.keys(env).find((key) => platform === "win32" ? key.toUpperCase() === "PATH" : key === "PATH") || "PATH";
  const inheritedDirs = pathDirectories(env[pathKey], platform);
  const knownDirs = platform === "win32" ? [] : [
    paths.join(home, ".local", "bin"),
    paths.join(home, ".npm-global", "bin"),
    ...(platform === "darwin" ? ["/opt/homebrew/bin"] : []),
    "/usr/local/bin", "/usr/bin", "/bin",
  ];
  // Finder's PATH lacks nvm/asdf/mise/Homebrew setup. Recover PATH only, never
  // secrets or CODEX_HOME, from the user's shell. The process is time bounded.
  const shellDirs = platform === "darwin"
    ? pathDirectories(await loginPath(env, home, runner), platform) : [];
  const directories = [...new Set([...inheritedDirs, ...shellDirs, ...knownDirs])];
  const childEnv = { ...env, [pathKey]: directories.join(platform === "win32" ? ";" : ":") };
  const candidates = [];
  if (platform === "win32" && env.LOCALAPPDATA) {
    candidates.push(paths.join(env.LOCALAPPDATA, "Programs", "OpenAI", "Codex", "bin", "codex.exe"));
    const desktopBin = paths.join(env.LOCALAPPDATA, "OpenAI", "Codex", "bin");
    try {
      for (const entry of await readDirectory(desktopBin, { withFileTypes: true })) {
        if (entry.isDirectory()) candidates.push(paths.join(desktopBin, entry.name, "codex.exe"));
      }
    } catch {
      // The desktop app is optional; PATH installations still work.
    }
  }
  for (const directory of directories) {
    const names = platform === "win32" ? ["codex.exe", "codex.cmd", "codex.bat", "codex.com"] : ["codex"];
    candidates.push(...names.map((name) => paths.join(directory, name)));
  }
  for (const executable of [...new Set(candidates)]) {
    if (await probe(executable, platform)) return { executable, env: childEnv };
  }
  return null;
}
