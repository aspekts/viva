/**
 * Signs an ElevenLabs voice session for the browser. The API key stays here, and the
 * agent requires signed URLs, so the agent ID alone can't spend credits.
 */
export class VoiceUnavailableError extends Error {}

const ELEVENLABS = "https://api.elevenlabs.io/v1";

export function voiceConfigured(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.ELEVENLABS_API_KEY && env.ELEVENLABS_AGENT_ID);
}

export async function signVoiceSession(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): Promise<{ signedUrl: string }> {
  if (!voiceConfigured(env)) throw new VoiceUnavailableError("voice is not configured: set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID");
  const url = `${ELEVENLABS}/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(env.ELEVENLABS_AGENT_ID!)}`;
  const response = await fetcher(url, { headers: { "xi-api-key": env.ELEVENLABS_API_KEY! }, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`ElevenLabs returned ${response.status}`);
  const body = (await response.json()) as { signed_url?: unknown };
  if (typeof body.signed_url !== "string") throw new Error("ElevenLabs returned no signed URL");
  return { signedUrl: body.signed_url };
}
