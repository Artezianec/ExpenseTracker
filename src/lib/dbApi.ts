const API_BASE = (import.meta.env.VITE_BUDGET_API_URL ?? '/api').replace(/\/$/, '');

async function dbRequest(
  accessToken: string,
  method: 'PUT' | 'PATCH' | 'DELETE',
  collection: string,
  id: string,
  body?: Record<string, unknown>,
): Promise<void> {
  const url = `${API_BASE}/db/collections/${encodeURIComponent(collection)}/documents/${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify({ data: body }) : undefined,
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    const message =
      typeof payload.error === 'string' ? payload.error : res.statusText;
    throw new Error(message || `HTTP ${res.status}`);
  }
}

export function dbSet(
  accessToken: string,
  collection: string,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  return dbRequest(accessToken, 'PUT', collection, id, data);
}

export function dbPatch(
  accessToken: string,
  collection: string,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  return dbRequest(accessToken, 'PATCH', collection, id, data);
}

export function dbDelete(
  accessToken: string,
  collection: string,
  id: string,
): Promise<void> {
  return dbRequest(accessToken, 'DELETE', collection, id);
}
