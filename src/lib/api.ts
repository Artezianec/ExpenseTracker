const API_BASE = (import.meta.env.VITE_BUDGET_API_URL ?? '/api').replace(/\/$/, '');
const TOKEN_KEY = 'budgeted_auth_token';

let accessToken: string | null =
  typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;

export function setAccessToken(token: string | null) {
  accessToken = token;
  if (typeof localStorage === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getAccessToken(): string | null {
  return accessToken;
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function parseError(res: Response): Promise<string> {
  const payload = await res.json().catch(() => ({}));
  return typeof payload.error === 'string' ? payload.error : res.statusText;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    throw new ApiError(await parseError(res), res.status);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export async function apiUploadForm<T>(
  path: string,
  formData: FormData,
  method: 'POST' | 'PUT' = 'POST',
): Promise<T> {
  const headers: Record<string, string> = {};
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: formData,
  });

  if (!res.ok) {
    throw new ApiError(await parseError(res), res.status);
  }

  return res.json() as Promise<T>;
}

export async function fetchAuthenticatedBlob(
  path: string,
): Promise<{ blob: Blob; filename?: string }> {
  const headers: Record<string, string> = {};
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) {
    throw new ApiError(await parseError(res), res.status);
  }

  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="([^"]+)"/);
  return {
    blob: await res.blob(),
    filename: match?.[1],
  };
}

export async function register(
  email: string,
  password: string,
  displayName?: string,
): Promise<{ token: string; user: import('../types').AppUser }> {
  return apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName }),
  });
}

export async function login(
  email: string,
  password: string,
): Promise<{ token: string; user: import('../types').AppUser }> {
  return apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function fetchMe(): Promise<{
  user: import('../types').AppUser;
  profile: import('../types').UserProfile;
}> {
  return apiFetch('/auth/me');
}
