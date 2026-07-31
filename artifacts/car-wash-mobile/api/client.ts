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

export async function apiFetch(
  path: string,
  options: RequestInit & { timeoutMs?: number } = {},
) {
  // Always bound a request in time. Without this, a hung socket — common on the
  // first request while the (free-tier) server cold-starts — never settles, and
  // any screen waiting on it (auth check, dashboards) spins forever.
  const { timeoutMs = 20000, signal: callerSignal, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', () => controller.abort());
  }

  let res: Response;
  try {
    res = await fetch(BASE_URL + path, {
      ...rest,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...rest.headers },
      signal: controller.signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new ApiError('The request timed out. Please try again.', 'timeout', 0);
    }
    throw new ApiError('Network request failed. Please check your connection.', 'network_error', 0);
  } finally {
    clearTimeout(timer);
  }

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
