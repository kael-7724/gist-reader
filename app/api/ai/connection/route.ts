import { validateAiEndpoint } from "@/lib/ai";
import { DEEPSEEK_ENDPOINT, DEEPSEEK_MODEL, readSharedSetting } from "@/lib/ai-connection";
import { chatJson } from "@/lib/ai-request";
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto";
import { database, message, ownerId } from "@/lib/site-data";

type Stored = { endpoint: string; model: string; encryptedApiKey: string; apiKeyIv: string };

export async function GET(request: Request) {
  try {
    const row = await database().prepare("SELECT endpoint, model, thinking_mode AS thinkingMode, connected_at AS connectedAt FROM ai_connections WHERE owner_id = ?").bind(ownerId(request)).first();
    if (row) return Response.json({ connected: true, ...row });
    // No key of its own: the account uses the shared key from /admin, if there is one.
    if (await readSharedSetting()) return Response.json({ connected: true, shared: true, endpoint: DEEPSEEK_ENDPOINT, model: DEEPSEEK_MODEL, thinkingMode: "disabled" });
    return Response.json({ connected: false });
  } catch (error) { return Response.json({ error: message(error) }, { status: 500 }); }
}

// Connect any OpenAI-compatible Chat Completions model. A short test request runs before saving,
// so a wrong address, key or model name is reported right away.
export async function POST(request: Request) {
  try {
    const owner = ownerId(request);
    const data = await request.json() as { apiKey?: string; endpoint?: string; model?: string; thinkingMode?: string };
    const endpoint = validateAiEndpoint((data.endpoint || DEEPSEEK_ENDPOINT).trim());
    const model = (data.model || "").trim();
    if (!/^[\w.:/@+-]{1,120}$/.test(model)) return Response.json({ error: "请填写模型名称" }, { status: 400 });
    const thinkingMode = data.thinkingMode === "enabled" ? "enabled" : "disabled";
    let apiKey = (data.apiKey || "").trim();
    if (apiKey.length > 500) return Response.json({ error: "API Key 无效" }, { status: 400 });
    const current = await database().prepare("SELECT endpoint, model, encrypted_api_key AS encryptedApiKey, api_key_iv AS apiKeyIv FROM ai_connections WHERE owner_id = ?").bind(owner).first<Stored>();
    if (!apiKey) {
      if (!current || current.endpoint !== endpoint) return Response.json({ error: "更换服务商或接口地址时请填写 API Key" }, { status: 400 });
      apiKey = await decryptSecret(request, current.encryptedApiKey, current.apiKeyIv);
    }
    if (!current || current.endpoint !== endpoint || current.model !== model || data.apiKey) {
      await chatJson({ endpoint, key: apiKey, model }, [
        { role: "system", content: "Reply with the JSON object {\"ok\":true} and nothing else." },
        { role: "user", content: "ping" },
      ], { maxTokens: 50, timeoutMs: 30000 }).catch((error: unknown) => { throw new Error(`连接测试没有通过：${message(error)}`); });
    }
    const encrypted = await encryptSecret(request, apiKey);
    await database().prepare(`INSERT INTO ai_connections (owner_id, endpoint, model, thinking_mode, encrypted_api_key, api_key_iv)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET endpoint = excluded.endpoint, model = excluded.model,
      thinking_mode = excluded.thinking_mode, encrypted_api_key = excluded.encrypted_api_key,
      api_key_iv = excluded.api_key_iv, connected_at = CURRENT_TIMESTAMP`)
      .bind(owner, endpoint, model, thinkingMode, encrypted.encryptedValue, encrypted.iv).run();
    return Response.json({ connected: true, endpoint, model, thinkingMode });
  } catch (error) { return Response.json({ error: message(error) }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  try {
    await database().prepare("DELETE FROM ai_connections WHERE owner_id = ?").bind(ownerId(request)).run();
    return Response.json({ connected: false });
  } catch (error) { return Response.json({ error: message(error) }, { status: 500 }); }
}
