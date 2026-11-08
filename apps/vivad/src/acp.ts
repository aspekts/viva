/**
 * Viva as an Agent Client Protocol agent, so ACP editors (JetBrains, Zed and others)
 * can run the exam in their agent chat. It is a thin client of the daemon: it starts
 * a review of the session's repo, asks one question per turn, and submits the answers.
 *
 *   pnpm viva acp     speaks ACP (newline-delimited JSON-RPC) on stdin and stdout
 *
 * stdout carries only protocol messages, so logs go to stderr.
 */
import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";
import type { Answer, Review } from "@viva/contracts";
import { allowsPush } from "@viva/engine";
import { DaemonClient } from "./client.js";

type Daemon = Pick<DaemonClient, "start" | "answer" | "skip">;
type Notify = (method: string, params: unknown) => void;

interface Session {
  cwd: string;
  updatedAt: string;
  review: Review | null;
  index: number;
  answers: Answer[];
}

export class RpcError extends Error {
  constructor(readonly code: number, message: string) { super(message); }
}

const PROTOCOL_VERSION = 1;

function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/** The same range and identity the push hook uses, worked out from the session's folder. */
export function reviewRequest(cwd: string, git = gitIn) {
  const repoPath = git(cwd, "rev-parse", "--show-toplevel");
  const head = git(cwd, "rev-parse", "HEAD");
  // Unpushed work first. With nothing unpushed, review the last commit.
  let base = "";
  for (const ref of ["@{upstream}", "origin/main", "main"]) {
    try {
      const candidate = git(cwd, "merge-base", ref, "HEAD");
      if (candidate !== head) { base = candidate; break; }
    } catch {
      // Try the next candidate.
    }
  }
  if (!base) base = git(cwd, "rev-parse", "HEAD~1");
  let person = "";
  try { person = git(cwd, "config", "user.name"); } catch { /* unset */ }
  let intent: string | undefined;
  try { intent = git(cwd, "log", "--format=%B", `${base}..HEAD`) || undefined; } catch { /* none */ }
  return { repoPath, base, head, person: person || userInfo().username, intent };
}

const promptText = (prompt: unknown): string =>
  Array.isArray(prompt)
    ? prompt.map((block) => (block && typeof block === "object" && (block as { type?: unknown }).type === "text" ? String((block as { text?: unknown }).text ?? "") : "")).join("\n").trim()
    : "";

export class VivaAcpAgent {
  private readonly sessions = new Map<string, Session>();
  private nextId = 1;

  constructor(
    private readonly notify: Notify,
    private readonly daemon: Daemon = new DaemonClient(),
    private readonly request = reviewRequest,
    private readonly fileAt = (repo: string, rev: string, file: string): string | null => {
      try { return gitIn(repo, "show", `${rev}:${file}`); } catch { return null; }
    },
  ) {}

  async handle(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    switch (method) {
      case "initialize":
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: { loadSession: false, promptCapabilities: { image: false, audio: false, embeddedContext: false }, sessionCapabilities: { list: {} } },
          agentInfo: { name: "viva", title: "Viva", version: "0.1.0" },
          authMethods: [],
        };
      case "authenticate":
        return {};
      case "session/new": {
        const cwd = String(params.cwd ?? "");
        if (!isAbsolute(cwd)) throw new RpcError(-32602, "cwd must be an absolute path");
        const sessionId = `viva-${this.nextId++}`;
        this.sessions.set(sessionId, { cwd, updatedAt: new Date().toISOString(), review: null, index: 0, answers: [] });
        // Sent after the response, once the client knows the session.
        setTimeout(() => {
          this.update(sessionId, {
            sessionUpdate: "available_commands_update",
            availableCommands: [
              { name: "review", description: "Review your unpushed commits and start the exam" },
              { name: "skip", description: "Push without passing, leaving the code under fog" },
            ],
          });
          this.update(sessionId, { sessionUpdate: "session_info_update", title: `Viva exam: ${basename(cwd)}` });
        }, 0);
        return { sessionId };
      }
      case "session/list": {
        // JetBrains Air only shows agents that can list their sessions.
        const cwd = typeof params.cwd === "string" ? params.cwd : null;
        const sessions = [...this.sessions.entries()]
          .filter(([, session]) => !cwd || session.cwd === cwd)
          .map(([sessionId, session]) => ({ sessionId, cwd: session.cwd, title: session.review ? `Viva exam ${session.review.id.slice(0, 8)}` : "Viva exam", updatedAt: session.updatedAt }));
        return { sessions };
      }
      case "session/prompt": {
        const session = this.sessions.get(String(params.sessionId));
        if (!session) throw new RpcError(-32602, "unknown session");
        session.updatedAt = new Date().toISOString();
        await this.turn(String(params.sessionId), session, promptText(params.prompt));
        return { stopReason: "end_turn" };
      }
      case "session/cancel":
        return null;
      default:
        throw new RpcError(-32601, `method not found: ${method}`);
    }
  }

  private update(sessionId: string, update: Record<string, unknown>) {
    this.notify("session/update", { sessionId, update });
  }

  private say(sessionId: string, text: string) {
    this.update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
  }

  /** The exam as a checklist that ticks off as each question is answered. */
  private progress(sessionId: string, session: Session, review: Review, done = false) {
    const entries = review.plan!.questions.map((q, i) => ({
      content: `Q${i + 1}: ${q.ask}`,
      priority: "high",
      status: done || i < session.index ? "completed" : i === session.index ? "in_progress" : "pending",
    }));
    this.update(sessionId, { sessionUpdate: "plan", entries });
  }

  /** Points the editor at the code a question is about. */
  private show(sessionId: string, session: Session, review: Review) {
    const q = review.plan!.questions[session.index]!;
    const { repoPath, base, head } = review.request;
    const path = join(repoPath, q.location.file);
    const newText = this.fileAt(repoPath, head, q.location.file);
    const content = newText === null ? [] : [{ type: "diff", path, oldText: this.fileAt(repoPath, base, q.location.file), newText }];
    this.update(sessionId, {
      sessionUpdate: "tool_call",
      toolCallId: `${review.id}-${q.id}`,
      title: `The change in question: ${q.location.file}:${q.location.lines[0]}-${q.location.lines[1]}`,
      kind: "read",
      status: "completed",
      content,
      locations: [{ path, line: q.location.lines[0] }],
    });
  }

  private ask(sessionId: string, session: Session, review: Review) {
    const questions = review.plan!.questions;
    const q = questions[session.index]!;
    this.progress(sessionId, session, review);
    this.show(sessionId, session, review);
    this.say(sessionId, `**Question ${session.index + 1} of ${questions.length}.** ${q.ask}\n\n_Answer in your own words. Say "skip" to push with debt._`);
  }

  private async turn(sessionId: string, session: Session, input: string) {
    let text = input;
    try {
      text = text.replace(/^\s*\//, "");
      if (!session.review || session.review.gate || /^\s*(review|again|restart)\s*$/i.test(text)) {
        await this.begin(sessionId, session);
        return;
      }
      const review = session.review;
      if (/^\s*skip\s*$/i.test(text)) {
        this.finish(sessionId, session, await this.daemon.skip(review.id));
        return;
      }
      const q = review.plan!.questions[session.index]!;
      session.answers.push({ questionId: q.id, transcript: text, mode: "typed" });
      session.index += 1;
      if (session.index < review.plan!.questions.length) {
        this.ask(sessionId, session, review);
        return;
      }
      this.say(sessionId, "Marking your answers…\n\n");
      this.finish(sessionId, session, await this.daemon.answer(review.id, session.answers));
    } catch (error) {
      this.say(sessionId, `Viva couldn't do that: ${error instanceof Error ? error.message : String(error)}. Is the daemon running (\`pnpm dev\`)?`);
    }
  }

  private async begin(sessionId: string, session: Session) {
    const request = this.request(session.cwd);
    this.say(sessionId, `Reviewing ${request.base.slice(0, 7)}..${request.head.slice(0, 7)} in \`${request.repoPath}\`…\n\n`);
    const review = await this.daemon.start(request);
    session.review = review;
    session.index = 0;
    session.answers = [];
    if (review.gate) {
      this.finish(sessionId, session, review);
      return;
    }
    const silent = review.claims.filter((c) => c.origin === "silent").length;
    this.say(sessionId, `I found ${review.claims.length} change${review.claims.length === 1 ? "" : "s"} worth asking about${silent ? `, ${silent} of them not asked for` : ""}. ${review.plan!.questions.length} question${review.plan!.questions.length === 1 ? "" : "s"} before this can be pushed.\n\n`);
    this.ask(sessionId, session, review);
  }

  private finish(sessionId: string, session: Session, review: Review) {
    session.review = review;
    if (review.plan?.questions.length) this.progress(sessionId, session, review, true);
    const gate = review.gate!;
    const lines = [`**${allowsPush(gate) ? "Push allowed" : "Push blocked"}**: ${gate.verdict} (${gate.reason}).`];
    for (const grade of review.grades) {
      const q = review.plan?.questions.find((x) => x.id === grade.questionId);
      lines.push(`- ${q?.ask ?? grade.questionId}: ${grade.verdict}, ${Math.round(grade.score * 100)}%${grade.missing.length ? `. Missed: ${grade.missing.join("; ")}` : ""}`);
    }
    lines.push(allowsPush(gate) ? "\nRun `git push` again and it goes through." : "\nSay \"review\" to try again after a fix, or \"skip\" to push with debt.");
    this.say(sessionId, lines.join("\n"));
  }
}

/** Newline-delimited JSON-RPC over stdio. */
export function serveAcp(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<void> {
  const send = (message: unknown) => output.write(`${JSON.stringify(message)}\n`);
  const agent = new VivaAcpAgent((method, params) => send({ jsonrpc: "2.0", method, params }));
  const lines = createInterface({ input });
  const closed = new Promise<void>((resolve) => lines.once("close", resolve));
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let message: { id?: unknown; method?: string; params?: Record<string, unknown> };
    try { message = JSON.parse(line); } catch { return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); }
    if (!message.method) return; // A response to something we never asked.
    void agent.handle(message.method, message.params).then(
      (result) => { if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, result }); },
      (error) => {
        if (message.id === undefined) return;
        const code = error instanceof RpcError ? error.code : -32603;
        send({ jsonrpc: "2.0", id: message.id, error: { code, message: error instanceof Error ? error.message : String(error) } });
      },
    );
  });
  return closed;
}
