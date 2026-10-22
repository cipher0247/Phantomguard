const SYSTEM = 'You are PHANTOMGUARD\'s security advisor. Give short, plain-language scam and online-safety advice. ' +
  'You are a general AI assistant, not a detection model: never claim to have scanned anything, and say when you are unsure.';

export async function askAdvisor(messages: { role: 'user' | 'assistant'; content: string }[]) {
  const geminiKey = process.env.GEMINI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!geminiKey && !anthropicKey) return { status: 503, body: { error: 'advisor_unconfigured', message: 'The AI advisor is not configured (missing API key).' } };
  const useGemini = !!geminiKey;
  const model = useGemini
    ? process.env.GEMINI_ADVISOR_MODEL ?? 'gemini-2.5-flash'
    : process.env.ADVISOR_MODEL ?? 'claude-haiku-5-5';
  const url = useGemini
    ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
    : 'https://api.anthropic.com/v1/messages';
  const headers: Record<string, string> = useGemini
    ? { 'x-goog-api-key': geminiKey!, 'content-type': 'application/json' }
    : { 'x-api-key': anthropicKey!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  const body = useGemini
    ? {
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: messages.map(({ role, content }) => ({ role: role === 'assistant' ? 'model' : 'user', parts: [{ text: content }] })),
        generationConfig: { maxOutputTokens: 600 },
      }
    : { model, max_tokens: 600, system: SYSTEM, messages };
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    if ((error as Error).name === 'TimeoutError')
      return { status: 504, body: { error: 'advisor_timeout', message: 'The advisor took too long to respond. Try again.' } };
    return { status: 502, body: { error: 'advisor_unreachable', message: 'The advisor provider could not be reached.' } };
  }
  if (res.status === 429) return { status: 429, body: { error: 'advisor_rate_limited', message: 'The advisor is busy. Try again in a moment.' } };
  if (!res.ok) return { status: 502, body: { error: 'advisor_failed', message: 'The advisor provider returned an error.' } };
  let j: any;
  try { j = await res.json(); } catch { return { status: 502, body: { error: 'advisor_failed', message: 'The advisor provider returned an invalid response.' } }; }
  const reply = useGemini
    ? (j?.candidates?.[0]?.content?.parts ?? []).filter((p: any) => typeof p.text === 'string').map((p: any) => p.text).join('\n').trim()
    : (j?.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
  if (!reply) return { status: 502, body: { error: 'advisor_failed', message: 'The advisor provider returned an empty response.' } };
  return { status: 200, body: { reply, source: 'ai-generated' as const } };
}
