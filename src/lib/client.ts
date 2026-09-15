/**
 * Thin fetch wrapper for client components. Components never talk to the
 * database — they call these, which call the API routes.
 */
export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly fields?: Record<string, string[]>) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) {
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`, body?.fields);
  }
  return body as T;
}

export const api = {
  get:  <T,>(url: string) => request<T>(url),
  post: <T,>(url: string, data?: unknown) =>
    request<T>(url, { method: 'POST', body: JSON.stringify(data ?? {}) }),
  put:  <T,>(url: string, data: unknown) =>
    request<T>(url, { method: 'PUT', body: JSON.stringify(data) }),
  patch:<T,>(url: string, data: unknown) =>
    request<T>(url, { method: 'PATCH', body: JSON.stringify(data) }),
  del:  <T,>(url: string) => request<T>(url, { method: 'DELETE' }),
};
