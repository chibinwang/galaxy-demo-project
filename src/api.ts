export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details: string[] = [],
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const isRaw = body instanceof Blob || body instanceof ArrayBuffer;
  const res = await fetch(url, {
    method,
    headers: body === undefined ? headers : isRaw ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : isRaw ? (body as BodyInit) : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status, data.details ?? []);
  return data as T;
}

export const api = {
  get: <T,>(url: string) => request<T>('GET', url),
  post: <T,>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T,>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: (url: string) => request<void>('DELETE', url),
  upload: <T,>(url: string, file: File) => request<T>('POST', url, file, { 'x-filename': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' }),
};

export const qs = (params: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
