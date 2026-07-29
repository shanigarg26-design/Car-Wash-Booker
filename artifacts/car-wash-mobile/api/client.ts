export const BASE_URL = process.env.EXPO_PUBLIC_API_BASE || '';

export class ApiError extends Error {
  code: string;
  status: number;
  data: Record<string, unknown>;

  constructor(message: string, code: string, status: number, data: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(BASE_URL + path, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });

  if (!res.ok) {
    let message = 'An error occurred';
    let code = 'unknown_error';
    let data: Record<string, unknown> = {};
    try {
      const errRes = await res.json();
      message = errRes.message || errRes.error || message;
      code = errRes.error || code;
      data = errRes;
    } catch {
      message = await res.text();
    }
    throw new ApiError(message, code, res.status, data);
  }

  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return null;
  }

  return res.json();
}
