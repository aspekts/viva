/** What the human asked for, and what the agent reasoned, for a change. */
export interface SessionContext {
  source: "entire" | "request" | "none";
  intent: string | null;
  transcript: string | null;
}

/** What a source may use to scope and bound what it returns. */
export interface SessionQuery {
  /** Commits after this one are being pushed. Without it, only `head` counts. */
  base?: string;
  /** Changed files, used to rank the agent's reasoning. */
  files?: string[];
  maxTokens?: number;
}

export interface SessionSource {
  load(repoPath: string, head: string, query?: SessionQuery): Promise<SessionContext | null>;
}

export async function resolveSession(
  source: SessionSource,
  repoPath: string,
  head: string,
  requestIntent?: string,
  query?: SessionQuery,
): Promise<SessionContext> {
  // Fail open: a broken source costs a review its context, never the review.
  const session = await source.load(repoPath, head, query).catch(() => null);
  if (session) return { ...session, intent: session.intent ?? requestIntent ?? null };
  if (requestIntent) return { source: "request", intent: requestIntent, transcript: null };
  return { source: "none", intent: null, transcript: null };
}
