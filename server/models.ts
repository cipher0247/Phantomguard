// Model adapters. No trained weights ship with this repo: each modality talks to an inference
// service YOU run (PG_*_MODEL_URL). Contract: POST JSON/multipart -> { score:0..1, label:string, model:string, details?:object }
export type Kind = 'text' | 'audio' | 'video';
export interface ModelResult { score: number; label: string; model: string; details?: Record<string, unknown> }
export class ModelUnavailable extends Error {}

const URLS: Record<Kind, string> = {
  get text() { return process.env.PG_TEXT_MODEL_URL ?? ''; },
  get audio() { return process.env.PG_AUDIO_MODEL_URL ?? ''; },
  get video() { return process.env.PG_VIDEO_MODEL_URL ?? ''; },
};
export const availability = () => ({ text: !!URLS.text, audio: !!URLS.audio, video: !!URLS.video, advisor: !!process.env.ANTHROPIC_API_KEY });

function parse(j: any): ModelResult {
  if (!j || typeof j.score !== 'number' || j.score < 0 || j.score > 1 || typeof j.label !== 'string')
    throw new Error('Model service returned an invalid response');
  return { score: j.score, label: j.label.slice(0, 80), model: String(j.model ?? 'unknown').slice(0, 80), details: j.details };
}

export async function runModel(kind: Kind, body: { text: string } | { file: Buffer; filename: string; mime: string }): Promise<ModelResult> {
  const url = URLS[kind];
  if (!url) throw new ModelUnavailable(`The ${kind} model is not configured on this server.`);
  let init: RequestInit;
  if ('text' in body) init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: body.text }) };
  else {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(body.file)], { type: body.mime }), body.filename);
    init = { method: 'POST', body: fd };
  }
  let res: Response;
  try { res = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) }); }
  catch { throw new ModelUnavailable(`The ${kind} model service is unreachable.`); }
  if (!res.ok) throw new ModelUnavailable(`The ${kind} model service failed (${res.status}).`);
  return parse(await res.json());
}
