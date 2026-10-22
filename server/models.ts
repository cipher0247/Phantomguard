// Model adapters. No trained weights ship with this repo: each modality talks to an inference
// service you run (PG_*_MODEL_URL). See README "Model service contract".
export type Kind = 'text' | 'audio' | 'video';
export interface ModelResult { score: number; label: string; model: string; version: string; details: Record<string, string | number | boolean> }

/** Service not configured, unreachable or erroring -> 503. */
export class ModelUnavailable extends Error {}
/** Service did not answer within PG_MODEL_TIMEOUT_MS -> 504. */
export class ModelTimeout extends Error {}
/** The model service refused this particular input (its 4xx) -> 422 with its short reason. */
export class ModelRejectedInput extends Error {}
/** Service answered with something that violates the contract -> 502. */
export class ModelBadResponse extends Error {}

const ENV: Record<Kind, string> = { text: 'PG_TEXT_MODEL_URL', audio: 'PG_AUDIO_MODEL_URL', video: 'PG_VIDEO_MODEL_URL' };
const urlOf = (k: Kind) => process.env[ENV[k]] ?? '';
const timeoutMs = (k: Kind) => Number(process.env.PG_MODEL_TIMEOUT_MS) || (k === 'text' ? 15_000 : 120_000);

export const availability = () => ({ text: !!urlOf('text'), audio: !!urlOf('audio'), video: !!urlOf('video'), advisor: !!(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY) });

/** Fail fast at startup on a malformed model URL (operator-supplied; must be http/https). */
export function validateConfig() {
  for (const k of Object.keys(ENV) as Kind[]) {
    const u = urlOf(k);
    if (u && !/^https?:$/.test(new URL(u).protocol)) throw new Error(`${ENV[k]} must be an http(s) URL`);
  }
}

const str = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;

export function parseModelResponse(j: any): ModelResult {
  if (!j || typeof j !== 'object' || typeof j.score !== 'number' || !Number.isFinite(j.score) || j.score < 0 || j.score > 1
    || !str(j.label, 80) || !str(j.model, 80) || !str(j.version, 40))
    throw new ModelBadResponse('The model service returned an invalid response.');
  // Only flat, bounded primitives are kept: details are shown to users and stored, so they must not carry large or nested payloads.
  const details: ModelResult['details'] = {};
  if (j.details && typeof j.details === 'object' && !Array.isArray(j.details))
    for (const [k, v] of Object.entries(j.details).slice(0, 16))
      if (k.length <= 40 && (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length <= (k === 'limitations' ? 500 : 200)))) details[k] = v as never;
  return { score: j.score, label: j.label, model: j.model, version: j.version, details };
}

export async function runModel(kind: Kind, body: { text: string } | { file: Buffer; filename: string; mime: string }): Promise<ModelResult> {
  const url = urlOf(kind);
  if (!url) throw new ModelUnavailable(`The ${kind} model is not configured on this server.`);
  let init: RequestInit;
  if ('text' in body) init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: body.text }) };
  else {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(body.file)], { type: body.mime }), body.filename);
    init = { method: 'POST', body: fd };
  }
  let res: Response;
  try { res = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs(kind)) }); }
  catch (e) {
    if ((e as Error).name === 'TimeoutError') throw new ModelTimeout(`The ${kind} model took too long to respond.`);
    throw new ModelUnavailable(`The ${kind} model service is unreachable.`);
  }
  if ([400, 413, 415, 422].includes(res.status)) {
    // The service judged this input unusable; relay its short, service-authored reason (bounded) rather than calling it an outage.
    const reason = await res.json().then((j: any) => (typeof j?.message === 'string' ? j.message.slice(0, 200) : ''), () => '');
    throw new ModelRejectedInput(reason || `The ${kind} model could not analyse this input.`);
  }
  if (!res.ok) throw new ModelUnavailable(`The ${kind} model service failed (${res.status}).`);
  let j: unknown;
  try { j = await res.json(); } catch (e) {
    if ((e as Error).name === 'TimeoutError') throw new ModelTimeout(`The ${kind} model took too long to respond.`);
    throw new ModelBadResponse('The model service returned an invalid response.');
  }
  return parseModelResponse(j);
}
