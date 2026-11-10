import { database } from "@/lib/site-data";
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto";

const API_BASE = "https://open.maimemo.com/open";

export async function encryptToken(request: Request, token: string) {
  const encrypted = await encryptSecret(request, token);
  return { encryptedToken: encrypted.encryptedValue, tokenIv: encrypted.iv };
}

export async function decryptToken(request: Request, encryptedToken: string, tokenIv: string) {
  return decryptSecret(request, encryptedToken, tokenIv);
}

export async function readMaimemoToken(request: Request, owner: string) {
  const row = await database().prepare("SELECT encrypted_token, token_iv FROM maimemo_connections WHERE owner_id = ?").bind(owner).first<{ encrypted_token: string; token_iv: string }>();
  if (!row) throw new Error("请先连接墨墨背单词");
  return decryptToken(request, row.encrypted_token, row.token_iv);
}

export async function maimemoRequest<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  const data = await response.json().catch(() => ({})) as T & { message?: string; error?: string };
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("墨墨凭证无效或已经失效");
    if (response.status === 429) throw new Error("墨墨请求过于频繁，请稍后重试");
    throw new Error(data.message || data.error || `墨墨接口请求失败（${response.status}）`);
  }
  return data;
}

export function sentenceFromContext(context: string, word: string) {
  const clean = context.replace(/\s+/g, " ").trim();
  const candidates = clean.match(/[^.!?]+[.!?]?/g)?.map((item) => item.trim()).filter(Boolean) || [clean];
  return candidates.find((item) => item.toLowerCase().includes(word.toLowerCase())) || clean;
}
