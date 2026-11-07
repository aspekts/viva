import { Review, ReviewFeedback, SavedMemory, type Answer, type ReviewRequest } from "@viva/contracts";

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export class DaemonClient {
  constructor(private readonly api = `http://127.0.0.1:${process.env.VIVA_PORT ?? "4317"}/v1`) {}

  private async json(path: string, body?: unknown) {
    const response = await fetch(`${this.api}${path}`, {
      ...(body === undefined ? {} : {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      // Only expected application errors carry actionable, non-provider messages.
      const detail = response.status < 500 ? await response.json() as { error?: string } : null;
      throw new ApiError(response.status, detail?.error ?? `daemon returned ${response.status}`);
    }
    return response.json();
  }

  async start(request: ReviewRequest) { return Review.parse(await this.json("/reviews", request)); }
  async review(id: string) { return Review.parse(await this.json(`/reviews/${encodeURIComponent(id)}`)); }
  async answer(id: string, answers: Answer[]) { return Review.parse(await this.json(`/reviews/${encodeURIComponent(id)}/answers`, answers)); }
  async skip(id: string) { return Review.parse(await this.json(`/reviews/${encodeURIComponent(id)}/skip`, {})); }
  async feedback(id: string) { return ReviewFeedback.parse(await this.json(`/reviews/${encodeURIComponent(id)}/feedback`)); }
  async saveMemory(id: string) { return SavedMemory.parse(await this.json(`/reviews/${encodeURIComponent(id)}/memory`, {})); }
}
