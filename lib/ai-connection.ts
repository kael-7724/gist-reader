import { database } from "@/lib/site-data";

export const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
export const DEEPSEEK_MODEL = "deepseek-flash";
const SHARED_KEY = "shared_deepseek";

export type AiConnection = { endpoint: string; model: string; thinkingMode: string; encryptedApiKey: string; apiKeyIv: string; shared: boolean };
type SharedSetting = { encryptedApiKey: string; apiKeyIv: string; last4: string; setAt: string };

// The site owner can set one DeepSeek key in /admin that every account uses until it connects its own.
export async function readSharedSetting() {
  const row = await database().prepare("SELECT value FROM self_host_settings WHERE key = ?").bind(SHARED_KEY).first<{ value: string }>().catch(() => null);
  if (!row) return null;
  try { return JSON.parse(row.value) as SharedSetting; } catch { return null; }
}

export async function writeSharedSetting(setting: SharedSetting | null) {
  if (!setting) { await database().prepare("DELETE FROM self_host_settings WHERE key = ?").bind(SHARED_KEY).run(); return; }
  await database().prepare("INSERT INTO self_host_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(SHARED_KEY, JSON.stringify(setting)).run();
}

// The account's own connection, or the shared key when it has none.
export async function aiConnectionFor(owner: string): Promise<AiConnection | null> {
  const own = await database().prepare("SELECT endpoint, model, thinking_mode AS thinkingMode, encrypted_api_key AS encryptedApiKey, api_key_iv AS apiKeyIv FROM ai_connections WHERE owner_id = ?")
    .bind(owner).first<Omit<AiConnection, "shared">>();
  if (own) return { ...own, shared: false };
  const shared = await readSharedSetting();
  if (!shared) return null;
  return { endpoint: DEEPSEEK_ENDPOINT, model: DEEPSEEK_MODEL, thinkingMode: "disabled", encryptedApiKey: shared.encryptedApiKey, apiKeyIv: shared.apiKeyIv, shared: true };
}
