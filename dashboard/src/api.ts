export async function api<T>(path: string, token?: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch('/api' + path, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } }).catch(() => { throw new Error('Cannot reach FocusLock. Check your connection and try again.'); });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const fallback = [502, 503, 504].includes(response.status) ? `The FocusLock API is not reachable (${response.status}). Check that the API service is running, then try again.`
      : response.status >= 500 ? `The FocusLock API hit an unexpected error (${response.status}). Refresh to see what was saved before retrying, and check the API logs if it persists.`
      : `Request failed (${response.status}).`;
    throw new ApiError(response.status, response.status === 401 ? 'Sign-in expired or credentials are invalid. Please sign in again.' : typeof body.detail === 'string' ? body.detail : Array.isArray(body.detail) ? body.detail.map((item: { msg?: string }) => item.msg ?? 'Invalid input').join('; ') : fallback);
  }
  return response.status === 204 ? undefined as T : response.json();
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const date = (value: string) => new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
export const stateLabel = (value: string) => value === 'checkin_pending' ? 'Check-in pending' : value.replace('_', ' ').replace(/^./, letter => letter.toUpperCase());
export const url64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
