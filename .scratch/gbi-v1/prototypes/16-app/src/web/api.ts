import type { Overview } from '../shared/view.ts';

async function call<T>(method: string, path: string, body?: unknown, raw?: BodyInit): Promise<T> {
  const res = await fetch(path, { method, headers: raw ? { 'content-type': 'application/octet-stream' } : body !== undefined ? { 'content-type': 'application/json' } : undefined, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: string }).error || `${method} ${path} failed (${res.status})`);
  return j as T;
}
export const api = {
  get: <T>(p: string) => call<T>('GET', p),
  post: <T = { ok: true }>(p: string, b?: unknown) => call<T>('POST', p, b ?? {}),
  put: <T = { ok: true }>(p: string, b: unknown) => call<T>('PUT', p, b),
  del: <T = { ok: true }>(p: string) => call<T>('DELETE', p),
  upload: <T>(p: string, file: File) => call<T>('POST', p, undefined, file),
  overview: () => call<Overview>('GET', '/api/overview')
};
