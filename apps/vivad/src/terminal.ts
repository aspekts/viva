import { openSync, closeSync } from "node:fs";
import { isatty, ReadStream } from "node:tty";

const AGENT_ENV = [
  "CLAUDECODE", "CODEX_THREAD_ID", "CODEX_CI", "CODEX_SANDBOX_NETWORK_DISABLED",
  "CURSOR_AGENT", "CLINE_ACTIVE", "AIDER_SESSION_ID", "OPENCODE", "OPENCODE_PID", "VIVA_NONINTERACTIVE",
];
const enabled = (value: string | undefined) => !!value && value !== "0" && value !== "false";

/** A PTY alone does not prove a person is present: agents also allocate PTYs. */
export function pushContext(env: NodeJS.ProcessEnv, outputTTY: boolean, platform = process.platform) {
  const automated = enabled(env.CI) || AGENT_ENV.some((key) => enabled(env[key]));
  return {
    terminal: outputTTY && !automated && env.TERM !== "dumb",
    openBrowser: !automated && !env.SSH_CONNECTION && !env.SSH_TTY &&
      (platform === "darwin" || platform === "win32" || !!env.DISPLAY || !!env.WAYLAND_DISPLAY),
  };
}

/** Never consume pre-push stdin: Git owns it and writes ref updates there. */
export function controllingTerminal(platform = process.platform): ReadStream | null {
  let fd: number | undefined;
  try {
    fd = openSync(platform === "win32" ? "CONIN$" : "/dev/tty", "r");
    if (!isatty(fd)) { closeSync(fd); return null; }
    const input = new ReadStream(fd);
    // Verify raw mode before showing a prompt, so early keystrokes are buffered
    // without echo. Ink takes ownership and runExam restores it on every exit.
    input.setRawMode(true);
    return input;
  } catch {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* A failed ReadStream may already own/close it. */ }
    }
    return null;
  }
}
