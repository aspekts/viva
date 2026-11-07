import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { LlmProvider, LlmRequest, LlmResult } from "./provider.js";

/** Safe to expose: never carries provider error bodies, prompts or model output. */
export class ModelUnavailableError extends Error {
  constructor(readonly reason: "capacity-or-timeout" | "replay-miss") {
    super(`Model unavailable (${reason}); no model verdict was produced. Retry later or use a recorded demo path.`);
    this.name = "ModelUnavailableError";
  }
}

export function isCapacityError(error: unknown): boolean {
  if (!(error instanceof Error) || error.name === "ZodError" || error instanceof SyntaxError) return false;
  return /Gemini returned (500|502|503|504)\b/.test(error.message)
    || /\b429\b|RESOURCE_EXHAUSTED|quota|rate.?limit|timed?\s*out|timeout/i.test(error.message)
    || ["TimeoutError", "AbortError"].includes(error.name);
}

export interface ResilientOptions {
  /** Includes model identity; changing models must not reuse another model's answers. */
  cacheIdentity: string;
  /** Explicit opt-in only. No directory means no cache reads or writes. */
  cacheDir?: string;
  record?: boolean;
  replayOnly?: boolean;
  fallback?: LlmProvider;
}

/**
 * Outside the live providers' bounded retries, inside MeteredProvider. Cached
 * token counts are retained so replay cannot bypass the per-review token cap.
 * Neither prompts nor provider errors are persisted. Cache failures are misses.
 */
export class ResilientProvider implements LlmProvider {
  private readonly used = new Set<string>();
  constructor(private readonly primary: LlmProvider, private readonly options: ResilientOptions) {}

  get id(): string {
    const modes = [...this.used];
    if (this.options.replayOnly && !modes.includes("replay")) modes.unshift("replay-only");
    return [this.primary.id, ...modes].join("+");
  }

  private path<T>(request: LlmRequest<T>): string | undefined {
    if (!this.options.cacheDir) return undefined;
    const key = createHash("sha256").update(JSON.stringify([
      1, this.primary.id, this.options.cacheIdentity, request.name, request.system, request.user,
      // Include the whole schema, not just its name, to invalidate changed contracts.
      zodToJsonSchema(request.schema, { $refStrategy: "none" }),
    ])).digest("hex");
    return join(this.options.cacheDir, `${key}.json`);
  }

  private async replay<T>(path: string | undefined, request: LlmRequest<T>): Promise<LlmResult<T> | null> {
    if (!path) return null;
    try {
      const cached = JSON.parse(await readFile(path, "utf8")) as LlmResult<unknown>;
      if (![cached.inputTokens, cached.outputTokens].every((n) => Number.isSafeInteger(n) && n >= 0)) return null;
      const parsed = request.schema.safeParse(cached.value);
      if (!parsed.success) return null;
      this.used.add("replay");
      return { value: parsed.data, inputTokens: cached.inputTokens, outputTokens: cached.outputTokens };
    } catch { return null; }
  }

  private async save<T>(path: string | undefined, result: LlmResult<T>): Promise<void> {
    if (!path || !this.options.record) return;
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      await mkdir(this.options.cacheDir!, { recursive: true, mode: 0o700 });
      await writeFile(temp, JSON.stringify(result), { mode: 0o600, flag: "wx" });
      await rename(temp, path);
    } catch {
      // A full disk or read-only cache must not break a successful live result.
    } finally {
      await rm(temp, { force: true }).catch(() => {});
    }
  }

  async complete<T>(request: LlmRequest<T>): Promise<LlmResult<T>> {
    const path = this.path(request);
    // Deterministic replay before spending any quota, including while recording.
    const cached = await this.replay(path, request);
    if (cached) return cached;
    if (this.options.replayOnly) {
      this.used.add("unavailable");
      throw new ModelUnavailableError("replay-miss");
    }
    try {
      const result = await this.primary.complete(request);
      const validated = { ...result, value: request.schema.parse(result.value) };
      await this.save(path, validated);
      return validated;
    } catch (error) {
      if (!isCapacityError(error)) throw error;
    }
    // Another concurrent call/process may have recorded it while we waited.
    const replay = await this.replay(path, request);
    if (replay) return replay;
    if (this.options.fallback) {
      try {
        const result = await this.options.fallback.complete(request);
        const validated = { ...result, value: request.schema.parse(result.value) };
        this.used.add("fallback");
        // Never attribute fallback results to the primary model's cache identity.
        return validated;
      } catch (error) {
        if (!isCapacityError(error)) throw error;
      }
    }
    this.used.add("unavailable");
    throw new ModelUnavailableError("capacity-or-timeout");
  }
}
