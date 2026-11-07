/** What the human asked for, and what the agent reasoned, for a change. */
export interface SessionContext {
  source: "entire" | "request" | "none";
  intent: string | null;
  transcript: string | null;
}

export interface SessionSource {
  load(repoPath: string, head: string): Promise<SessionContext | null>;
}

/**
 * TODO(marcus): read the Entire-Checkpoint trailer on `head`, then fetch the
 * checkpoint. Confirm how `entire checkpoint explain` can be scripted first.
 */
export const entireSource: SessionSource = {
  async load() {
    return null;
  },
};

export async function resolveSession(
  source: SessionSource,
  repoPath: string,
  head: string,
  requestIntent?: string,
): Promise<SessionContext> {
  const session = await source.load(repoPath, head);
  if (session) return session;
  if (requestIntent) return { source: "request", intent: requestIntent, transcript: null };
  return { source: "none", intent: null, transcript: null };
}
