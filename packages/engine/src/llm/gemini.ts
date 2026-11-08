import { zodToJsonSchema } from "zod-to-json-schema";
import type { LlmProvider, LlmRequest, LlmResult } from "./provider.js";

/** Gemini rejects tuple schemas, where `items` is an array, so flatten them. */
export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (typeof schema !== "object" || schema === null) return schema;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "$schema") continue;
    copy[key] = key === "items" && Array.isArray(value) ? toGeminiSchema(value[0]) : toGeminiSchema(value);
  }
  return copy;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const ATTEMPTS_PER_MODEL = 2;
const REQUEST_TIMEOUT_MS = 12_000;

export class GeminiProvider implements LlmProvider {
  readonly id = "gemini";

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fallbackModel?: string,
    private readonly backoffMs = 800,
    /** Shared-key evals stop on the first 429 instead of retrying/falling back. */
    private readonly retryRateLimits = true,
  ) {}

  /** Capacity errors are common, so retry, then fall back to the second model. */
  private async request(body: string): Promise<Response> {
    const models = this.fallbackModel ? [this.model, this.fallbackModel] : [this.model];
    let last: Response | undefined;
    let failure: unknown;
    for (const model of models) {
      for (let attempt = 0; attempt < ATTEMPTS_PER_MODEL; attempt += 1) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        try {
          last = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
            body,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
          if (!RETRYABLE.has(last.status) || (last.status === 429 && !this.retryRateLimits)) return last;
        } catch (error) {
          failure = error;
        }
        await new Promise((resolve) => setTimeout(resolve, this.backoffMs * (attempt + 1)));
      }
    }
    if (last) return last;
    throw failure;
  }

  async complete<T>({ system, user, schema }: LlmRequest<T>): Promise<LlmResult<T>> {
    const response = await this.request(
      JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: toGeminiSchema(zodToJsonSchema(schema, { $refStrategy: "none" })),
        },
      }),
    );
    if (!response.ok) {
      throw new Error(`Gemini returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    const body = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini returned no content");
    return {
      value: schema.parse(JSON.parse(text)),
      inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }
}
