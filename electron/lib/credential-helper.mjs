import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const PRINT_TOKEN_ARG = "--json-codex-print-token";

export function helperWrapperPath(userData, platform = process.platform) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  return paths.join(userData, platform === "win32" ? "print-token.cmd" : "print-token.sh");
}

export function quotePosixArgument(value) {
  const text = String(value);
  if (text.includes("\0")) throw new Error("Executable arguments cannot contain NUL.");
  return `'${text.replaceAll("'", "'\\''")}'`;
}

export function helperWrapperScript(executable, { platform = process.platform, appPath, userData } = {}) {
  if (platform === "win32") {
    // Preserve the Windows wrapper: Chromium can write an initial bare CRLF.
    return [
      "@echo off",
      "setlocal",
      `for /f "usebackq delims=" %%T in (\`"${executable}" ${PRINT_TOKEN_ARG}\`) do (`,
      '  <nul set /p "=%%T"',
      "  exit /b 0",
      ")",
      "exit /b 1",
      "",
    ].join("\r\n");
  }

  const command = [
    executable,
    ...(appPath ? [appPath] : []),
    ...(userData ? [`--user-data-dir=${userData}`] : []),
    PRINT_TOKEN_ARG,
  ]
    .map(quotePosixArgument).join(" ");
  return [
    "#!/bin/sh",
    // A parent's Node-mode flag must not prevent Electron's safeStorage startup.
    "unset ELECTRON_RUN_AS_NODE",
    `output=$(${command})`,
    "status=$?",
    '[ "$status" -eq 0 ] || exit "$status"',
    // printf treats token text as data. awk strips startup CRLF and emits no
    // trailing newline; an empty response fails instead of authenticating blank.
    "printf '%s\\n' \"$output\" | /usr/bin/awk '{ sub(/\\r$/, \"\"); if (length($0)) { printf \"%s\", $0; found = 1; exit } } END { if (!found) exit 1 }'",
    "",
  ].join("\n");
}

export async function writeHelperWrapper({ userData, executable, platform = process.platform, appPath }) {
  const filePath = helperWrapperPath(userData, platform);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, helperWrapperScript(executable, { platform, appPath, userData }), { mode: 0o700 });
  await rename(temporaryPath, filePath);
  if (platform !== "win32") await chmod(filePath, 0o700);
  return filePath;
}
