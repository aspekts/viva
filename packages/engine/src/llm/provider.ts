import type { Usage } from "@viva/contracts";
import type { ZodType } from "zod";

export interface LlmRequest<T> {
  /** Short stage name for traces, such as "check:silent-decision". */
  name: string;
  system: string;
  user: string;
  schema: ZodType<T>;
}

export interface LlmResult<T> {
  value: T;
  inputTokens: number;
  outputTokens: number;
}

/** Everything model-specific sits behind this, so providers can be swapped. */
export interface LlmProvider {
  id: string;
  complete<T>(request: LlmRequest<T>): Promise<LlmResult<T>>;
}

export class BudgetExceededError extends Error {}

/** Wraps a provider with usage counting and a per-review token cap. */
export class MeteredProvider implements LlmProvider {
  readonly id: string;
  readonly usage: Usage = { inputTokens: 0, outputTokens: 0, llmCalls: 0 };

  constructor(
    private readonly inner: LlmProvider,
    private readonly maxInputTokens: number,
  ) {
    this.id = inner.id;
  }

  async complete<T>(request: LlmRequest<T>): Promise<LlmResult<T>> {
    if (this.usage.inputTokens >= this.maxInputTokens) {
      throw new BudgetExceededError(`token budget used before ${request.name}`);
    }
    const result = await this.inner.complete(request);
    this.usage.inputTokens += result.inputTokens;
    this.usage.outputTokens += result.outputTokens;
    this.usage.llmCalls += 1;
    return result;
  }
}

/** Wraps untrusted text so prompts can treat it as data, never as instructions. */
export function untrusted(label: string, text: string): string {
  return `<untrusted name="${label}">\n${text.replaceAll("</untrusted", "<\\/untrusted")}\n</untrusted>`;
}
