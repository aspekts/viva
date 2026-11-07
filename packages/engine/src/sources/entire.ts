import { spawn } from "node:child_process";
import { z } from "zod";
import { CHARS_PER_TOKEN } from "../llm/provider.js";
import { git } from "./git.js";
import type { SessionContext, SessionSource } from "./session.js";

/**
 * Reads Entire checkpoints straight from git. Checkpoints are ordinary objects,
 * so this needs no CLI or network, and a repo without them simply finds nothing.
 * Layout: https://docs.entire.com/guides/checkpoints/checkpoint-storage
 */

/** Legacy hex or ULID. Trailers are free text, so only these reach a git revision. */
const CHECKPOINT_ID = /^(?:[0-9a-f]{12}|[0-9A-HJKMNP-TV-Z]{26})$/;
const PROMPT_SEPARATOR = "\n\n---\n\n";
const TRUNCATED = " [truncated]";
const EDIT_TOOL = /edit|write|patch/i;

const MAX_COMMITS = 100;
const MAX_SESSIONS = 32;
const MAX_PASSAGE_CHARS = 4_000;
const MAX_LINE_BYTES = 256 * 1024;
/** Without a budget from the caller, stay well inside one check's share of a review. */
const DEFAULT_MAX_TOKENS = 8_000;
/** Prompts come first, but one huge paste must not crowd out all the reasoning. */
const INTENT_SHARE = 0.6;
const READ_TIMEOUT_MS = 10_000;

const Summary = z.object({ sessions: z.array(z.unknown()) });
const Offset = z.number().int().nonnegative().nullish();
const SessionMeta = z.object({ checkpoint_transcript_start: Offset, compact_transcript_start: Offset });

const Block = z.object({
  type: z.string().optional(),
  text: z.string().optional(),
  thinking: z.string().optional(),
  name: z.string().optional(),
  input: z.record(z.unknown()).optional(),
});
/** `full.jsonl` nests content in `message`, while `transcript.jsonl` holds it directly. */
const TranscriptRecord = z.object({
  type: z.string().optional(),
  content: z.array(Block).optional(),
  message: z.object({ content: z.array(Block) }).optional(),
});

interface Passage {
  text: string;
  /** Higher is more relevant to the changed files. */
  relevance: number;
}

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, Math.max(0, max - TRUNCATED.length))}${TRUNCATED}`.slice(0, max);

function changedPath(path: string, files: string[]): string | undefined {
  const normal = path.replaceAll("\\", "/");
  return files.find((f) => normal === f || normal.endsWith(`/${f}`));
}

const mentionsChange = (text: string, files: string[]): boolean =>
  files.some((f) => text.includes(f) || text.includes(f.slice(f.lastIndexOf("/") + 1)));

/** Tool output is left behind: it is the bulk of a transcript, and not reasoning. */
function readBlock(block: z.infer<typeof Block>, files: string[], reasoning: Passage | undefined): Passage | undefined {
  if (block.type === "text" || block.type === "thinking") {
    const text = (block.text ?? block.thinking ?? "").trim();
    if (!text) return undefined;
    return { text: clip(text, MAX_PASSAGE_CHARS), relevance: mentionsChange(text, files) ? 3 : 1 };
  }
  if (block.type !== "tool_use" || !block.name) return undefined;
  const path = block.input?.file_path ?? block.input?.path;
  if (EDIT_TOOL.test(block.name) && typeof path === "string") {
    const changed = changedPath(path, files);
    // The reasoning just before an edit to a changed file is what explains it.
    if (changed && reasoning) reasoning.relevance = 4;
    return { text: clip(`[${block.name}] ${changed ?? path}`, MAX_PASSAGE_CHARS), relevance: changed ? 4 : 0 };
  }
  const description = block.input?.description;
  return typeof description === "string" && description.trim()
    ? { text: clip(`[${block.name}] ${description.trim()}`, MAX_PASSAGE_CHARS), relevance: 0 }
    : undefined;
}

/** Skip oversized lines before decoding or parsing; retain physical line offsets. */
export async function boundedLines(
  chunks: AsyncIterable<Buffer>,
  onLine: (line: string, index: number) => void,
  maxBytes = MAX_LINE_BYTES,
) {
  const buffer = Buffer.alloc(maxBytes);
  let length = 0;
  let skipped = false;
  let index = 0;
  for await (const chunk of chunks) {
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start);
      const end = newline < 0 ? chunk.length : newline;
      const size = end - start;
      if (length + size > maxBytes) skipped = true;
      if (!skipped) {
        chunk.copy(buffer, length, start, end);
        length += size;
      }
      if (newline < 0) break;
      if (!skipped) onLine(buffer.toString("utf8", 0, length).replace(/\r$/, ""), index);
      index += 1;
      length = 0;
      skipped = false;
      start = newline + 1;
    }
  }
  if (!skipped && length > 0) onLine(buffer.toString("utf8", 0, length).replace(/\r$/, ""), index);
}

async function forEachLine(repoPath: string, object: string, timeout: number, onLine: (line: string, index: number) => void) {
  const child = spawn("git", ["cat-file", "blob", object], {
    cwd: repoPath,
    stdio: ["ignore", "pipe", "ignore"],
    timeout,
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const [code] = await Promise.all([exited, boundedLines(child.stdout, onLine)]);
  if (code !== 0) throw new Error("could not read transcript");
}

/** Keep the ranked prefix that could fill the entire budget, plus one boundary passage.
 * A pending reasoning passage is added only after any following edit can promote it.
 * Bounds include separators: even one-character passages cannot grow the array forever.
 */
export class PassageBuffer {
  private ranked: { passage: Passage; index: number }[] = [];
  private chars = 0;
  private sequence = 0;
  pruned = false;

  constructor(private readonly room: number) {}

  nextIndex() {
    return this.sequence++;
  }

  add(passage: Passage, index: number) {
    const duplicate = this.ranked.findIndex((entry) => entry.passage.text === passage.text);
    if (duplicate >= 0) {
      // Pending reasoning can arrive after a later tool with identical text.
      if (this.ranked[duplicate]!.index < index) return;
      this.ranked.splice(duplicate, 1);
      this.chars -= passage.text.length + 2;
    }
    const entry = { passage, index };
    const position = this.ranked.findIndex((other) =>
      other.passage.relevance < passage.relevance ||
      (other.passage.relevance === passage.relevance && other.index < index));
    this.ranked.splice(position < 0 ? this.ranked.length : position, 0, entry);
    this.chars += passage.text.length + 2;
    while (this.ranked.length > 0) {
      const last = this.ranked[this.ranked.length - 1]!;
      const size = last.passage.text.length + 2;
      if (this.chars - size < this.room) break;
      this.ranked.pop();
      this.chars -= size;
      this.pruned = true;
    }
  }

  get retainedChars() {
    return this.chars;
  }
  get passages() {
    return [...this.ranked].sort((a, b) => a.index - b.index).map((entry) => entry.passage);
  }
}

function parseRecord(line: string, type: "assistant" | "user") {
  if (!line.includes(`"${type}"`)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }
  const record = TranscriptRecord.safeParse(parsed);
  if (!record.success || record.data.type !== type) return [];
  return record.data.content ?? record.data.message?.content ?? [];
}

async function readPassages(repoPath: string, object: string, start: number, files: string[], timeout: number, room: number) {
  const passages = new PassageBuffer(room);
  let reasoning: Passage | undefined;
  let reasoningIndex = 0;
  await forEachLine(repoPath, object, timeout, (line, index) => {
    if (index < start) return;
    for (const block of parseRecord(line, "assistant")) {
      const passage = readBlock(block, files, reasoning);
      if (!passage) continue;
      const order = passages.nextIndex();
      if (block.type !== "tool_use") {
        if (reasoning) passages.add(reasoning, reasoningIndex);
        reasoning = passage;
        reasoningIndex = order;
      } else passages.add(passage, order);
    }
  });
  if (reasoning) passages.add(reasoning, reasoningIndex);
  return passages;
}

/** A commit later in a turn has no `prompt.txt`, as the prompt went to an earlier one. */
async function readLastPrompt(repoPath: string, object: string, timeout: number): Promise<string> {
  let prompt = "";
  await forEachLine(repoPath, object, timeout, (line) => {
    const text = parseRecord(line, "user")
      .map((block) => block.text ?? "")
      .join("\n");
    if (text.trim()) prompt = text;
  });
  return prompt;
}

async function checkpointIds(repoPath: string, head: string, base?: string): Promise<string[]> {
  const output = await git(repoPath, [
    "log",
    "--reverse",
    `--max-count=${base ? MAX_COMMITS : 1}`,
    "--format=%(trailers:key=Entire-Checkpoint,valueonly)",
    base ? `${base}..${head}` : head,
  ]);
  const ids = output.split("\n").map((line) => line.trim());
  return [...new Set(ids.filter((id) => CHECKPOINT_ID.test(id)))];
}

const readJson = async (repoPath: string, object: string): Promise<unknown> =>
  JSON.parse(await git(repoPath, ["cat-file", "blob", object]));

/** New checkpoints have a ref each. Older ones share the `entire/checkpoints/v1` branch. */
async function locate(repoPath: string, id: string): Promise<{ root: string; sessions: number } | null> {
  const sharded = `${id.slice(0, 2)}/${id.slice(2)}/`;
  const roots = [
    `refs/entire/checkpoints/${id.slice(-2)}/${id}:`,
    `refs/heads/entire/checkpoints/v1:${sharded}`,
    `refs/remotes/origin/entire/checkpoints/v1:${sharded}`,
  ];
  for (const root of roots) {
    const summary = Summary.safeParse(await readJson(repoPath, `${root}metadata.json`).catch(() => null));
    if (summary.success) return { root, sessions: Math.min(summary.data.sessions.length, MAX_SESSIONS) };
  }
  return null;
}

/**
 * Only the turns since the session's previous checkpoint count. `full.jsonl`
 * keeps thinking but is in each agent's own format, so anything we cannot read
 * there falls back to the normalised `transcript.jsonl`, which has no thinking.
 */
async function readSession(repoPath: string, root: string, files: string[], deadline: number, room: number) {
  const meta = SessionMeta.parse(await readJson(repoPath, `${root}metadata.json`));
  const remaining = () => Math.max(1, deadline - Date.now());
  const compact = `${root}transcript.jsonl`;

  const prompts =
    (await git(repoPath, ["cat-file", "blob", `${root}prompt.txt`]).catch(() => null)) ??
    (await readLastPrompt(repoPath, compact, remaining()).catch(() => ""));

  const transcripts = [
    { object: `${root}full.jsonl`, start: meta.checkpoint_transcript_start ?? 0 },
    { object: compact, start: meta.compact_transcript_start ?? 0 },
  ];
  let passages = new PassageBuffer(room);
  for (const { object, start } of transcripts) {
    if (passages.passages.length === 0) passages = await readPassages(repoPath, object, start, files, remaining(), room).catch(() => new PassageBuffer(room));
  }
  return { prompts: prompts.split(PROMPT_SEPARATOR), passages };
}

/** Shares room equally, and short texts hand what they do not need to long ones. */
function shareEvenly(texts: string[], room: number): string[] {
  const shares = new Map<number, number>();
  const shortestFirst = texts.map((_, i) => i).sort((a, b) => (texts[a]?.length ?? 0) - (texts[b]?.length ?? 0));
  let left = Math.max(0, room);
  shortestFirst.forEach((index, position) => {
    const take = Math.min(texts[index]?.length ?? 0, Math.floor(left / (texts.length - position)));
    shares.set(index, take);
    left -= take;
  });
  return texts.map((text, i) => clip(text, shares.get(i) ?? 0));
}

/** Keeps the most relevant passages, latest first on a tie, then restores their order. */
function selectPassages(passages: Passage[], room: number, pruned: boolean): string | null {
  const ranked = passages
    .map((passage, index) => ({ ...passage, index }))
    .sort((a, b) => b.relevance - a.relevance || b.index - a.index);

  // Once pruning starts, an exact unique total would itself require unbounded storage.
  const note = (kept: number) =>
    (pruned || kept < passages.length) ? `[Viva kept ${kept}${pruned ? "" : ` of ${passages.length}`} agent passages, by relevance to the changed files.]\n\n` : "";
  let left = room - note(0).length;
  const kept: { index: number; text: string }[] = [];
  for (const { index, text } of ranked) {
    if (left < Math.min(text.length, TRUNCATED.length * 4)) break;
    const fitted = clip(text, left);
    kept.push({ index, text: fitted });
    left -= fitted.length + 2;
  }
  if (kept.length === 0) return null;
  const body = kept
    .sort((a, b) => a.index - b.index)
    .map((k) => k.text)
    .join("\n\n");
  return `${note(kept.length)}${body}`;
}

export function fitSession(prompts: string[], passages: Passage[], maxTokens: number, pruned = false): SessionContext | null {
  const maxChars = Math.floor(maxTokens * CHARS_PER_TOKEN);
  const wanted = prompts.reduce((sum, p) => sum + p.length + PROMPT_SEPARATOR.length, 0);
  const intentRoom = passages.length > 0 ? Math.min(wanted, Math.floor(maxChars * INTENT_SHARE)) : Math.min(wanted, maxChars);
  const separators = PROMPT_SEPARATOR.length * Math.max(0, prompts.length - 1);
  const intent = shareEvenly(prompts, intentRoom - separators)
    .filter(Boolean)
    .join(PROMPT_SEPARATOR);
  const transcript = selectPassages(passages, maxChars - intent.length, pruned);
  if (!intent && !transcript) return null;
  return { source: "entire", intent: intent || null, transcript };
}

export const entireSource: SessionSource = {
  async load(repoPath, head, { base, files = [], maxTokens = DEFAULT_MAX_TOKENS } = {}) {
    // Fail open, and log nothing: git errors can carry the output they failed on.
    try {
      const deadline = Date.now() + READ_TIMEOUT_MS;
      const prompts = new Set<string>();
      const room = Math.max(0, Math.floor(maxTokens * CHARS_PER_TOKEN));
      const passages = new PassageBuffer(room);
      for (const id of await checkpointIds(repoPath, head, base)) {
        const checkpoint = await locate(repoPath, id);
        for (let index = 0; index < (checkpoint?.sessions ?? 0); index += 1) {
          const session = await readSession(repoPath, `${checkpoint?.root}${index}/`, files, deadline, room).catch(() => null);
          for (const prompt of session?.prompts ?? []) if (prompt.trim()) prompts.add(prompt.trim());
          // Deduplicate retained overlapping turns without an unbounded set of discarded text.
          for (const passage of session?.passages.passages ?? []) passages.add(passage, passages.nextIndex());
          passages.pruned ||= session?.passages.pruned ?? false;
        }
      }
      return fitSession([...prompts], passages.passages, maxTokens, passages.pruned);
    } catch {
      return null;
    }
  },
};
