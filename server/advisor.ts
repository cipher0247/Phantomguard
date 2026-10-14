const SYSTEM = 'You are PHANTOMGUARD\'s security advisor. Give short, plain-language scam and online-safety advice. ' +
  'You are a general AI assistant, not a detection model: never claim to have scanned anything, and say when you are unsure.';

export async function askAdvisor(messages: { role: 'user' | 'assistant'; content: string }[]) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { status: 503, body: { error: 'advisor_unconfigured', message: 'The AI advisor is not configured (missing API key).' } };
  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.ADVISOR_MODEL ?? 'claude-haiku-5-5', max_tokens: 600, system: SYSTEM, messages }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch { return { status: 502, body: { error: 'advisor_unreachable', message: 'The advisor provider could not be reached.' } }; }
  if (res.status === 429) return { status: 429, body: { error: 'advisor_rate_limited', message: 'The advisor is busy. Try again in a moment.' } };
  if (!res.ok) return { status: 502, body: { error: 'advisor_failed', message: 'The advisor provider returned an error.' } };
  const j: any = await res.json();
  const reply = (j.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
  return { status: 200, body: { reply, source: 'ai-generated' as const } };
}
