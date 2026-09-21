export function getStoredVaultKey(): string {
  let key = localStorage.getItem('bms_vault_key');
  if (!key) {
    key = `vlt_${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 10)}`;
    localStorage.setItem('bms_vault_key', key);
  }
  return key;
}

export async function safeJson<T = any>(res: Response): Promise<T | null> {
  try {
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export async function apiFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem('bms_auth_token');
  const vaultKey = getStoredVaultKey();

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (vaultKey) {
    headers['x-vault-key'] = vaultKey;
  }

  const base = import.meta.env.VITE_API_URL || '';
  return fetch(`${base}${endpoint}`, {
    ...options,
    headers,
  });
}
