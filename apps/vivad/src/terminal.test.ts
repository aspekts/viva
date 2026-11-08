import { describe, expect, it, vi, afterEach } from "vitest";
import { pushContext, controllingTerminal } from "./terminal.js";
import * as fs from "node:fs";
import * as tty from "node:tty";

vi.mock("node:fs", async (original) => ({ ...await original<typeof import("node:fs")>(), openSync: vi.fn(), closeSync: vi.fn() }));
vi.mock("node:tty", async (original) => ({ ...await original<typeof import("node:tty")>(), isatty: vi.fn(), ReadStream: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

describe("push context", () => {
  it("uses a real terminal even when hook stdin is not a TTY", () => {
    expect(pushContext({ TERM: "xterm-256color" }, true).terminal).toBe(true);
    expect(pushContext({ TERM_PROGRAM: "vscode" }, true).terminal).toBe(true);
  });

  it.each(["CI", "CLAUDECODE", "CODEX_THREAD_ID", "CODEX_CI", "CODEX_SANDBOX_NETWORK_DISABLED", "CURSOR_AGENT", "CLINE_ACTIVE", "OPENCODE", "OPENCODE_PID", "VIVA_NONINTERACTIVE"])("does not stall %s, even in a PTY", (key) => {
    expect(pushContext({ [key]: "1" }, true)).toEqual({ terminal: false, openBrowser: false });
  });

  it("hands a desktop IDE push to the browser without assuming it has a terminal", () => {
    expect(pushContext({}, false, "win32")).toEqual({ terminal: false, openBrowser: true });
    expect(pushContext({ TERM: "dumb" }, true, "darwin").terminal).toBe(false);
    expect(pushContext({ CI: "false" }, true).terminal).toBe(true);
  });

  it("does not open browsers on a headless or SSH host", () => {
    expect(pushContext({}, false, "linux").openBrowser).toBe(false);
    expect(pushContext({ DISPLAY: ":0" }, false, "linux").openBrowser).toBe(true);
    expect(pushContext({ SSH_CONNECTION: "remote" }, false, "darwin").openBrowser).toBe(false);
  });
});

describe("controlling terminal", () => {
  it.each([["darwin", "/dev/tty"], ["win32", "CONIN$"]] as const)("tries the platform console on %s, with an unavailable-console fallback", (platform, path) => {
    const open = vi.spyOn(fs, "openSync").mockImplementation(() => { throw new Error("no console"); });
    expect(controllingTerminal(platform)).toBeNull();
    expect(open).toHaveBeenCalledWith(path, "r");
  });

  it("closes a console that is not a TTY", () => {
    vi.spyOn(fs, "openSync").mockReturnValue(123);
    vi.spyOn(tty, "isatty").mockReturnValue(false);
    const close = vi.spyOn(fs, "closeSync").mockImplementation(() => {});
    expect(controllingTerminal()).toBeNull();
    expect(close).toHaveBeenCalledWith(123);
  });

  it("enables raw mode before exposing the prompt and leaves stdin alone", () => {
    vi.spyOn(fs, "openSync").mockReturnValue(123);
    vi.spyOn(tty, "isatty").mockReturnValue(true);
    const input = { setRawMode: vi.fn() } as unknown as tty.ReadStream;
    vi.spyOn(tty, "ReadStream").mockReturnValue(input);
    expect(controllingTerminal()).toBe(input);
    expect(input.setRawMode).toHaveBeenCalledExactlyOnceWith(true);
    expect(tty.ReadStream).toHaveBeenCalledWith(123);
  });

  it("falls back even if a failed console has already closed its descriptor", () => {
    vi.spyOn(fs, "openSync").mockReturnValue(123);
    vi.spyOn(tty, "isatty").mockReturnValue(true);
    vi.spyOn(tty, "ReadStream").mockImplementation(() => { throw new Error("console failed"); });
    vi.spyOn(fs, "closeSync").mockImplementation(() => { throw new Error("already closed"); });
    expect(controllingTerminal()).toBeNull();
  });
});
