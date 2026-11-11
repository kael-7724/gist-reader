import { encryptSecret } from "@/lib/secret-crypto";
import { DEEPSEEK_ENDPOINT, DEEPSEEK_MODEL, readSharedSetting } from "@/lib/ai-connection";
import { database, message, ownerId } from "@/lib/site-data";

export async function GET(request: Request) {
  try {
    const row = await database().prepare("SELECT endpoint, model, thinking_mode AS thinkingMode, connected_at AS connectedAt FROM ai_connections WHERE owner_id = ?").bind(ownerId(request)).first();
    if (row) return Response.json({ connected: true, ...row });
    // No key of its own: the account uses the shared key from /admin, if there is one.
    if (await readSharedSetting()) return Response.json({ connected: true, shared: true, endpoint: DEEPSEEK_ENDPOINT, model: DEEPSEEK_MODEL, thinkingMode: "disabled" });
    return Response.json({ connected: false });
  } catch (error) { return Response.json({ error: message(error) }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const owner = ownerId(request);
    const data = await request.json() as { apiKey?: string; thinkingMode?: string };
    const endpoint = "https://api.deepseek.com/chat/completions";
    const model = "deepseek-flash";
    const apiKey = (data.apiKey || "").trim();
    const thinkingMode = data.thinkingMode === "enabled" ? "enabled" : "disabled";
    if (apiKey.length > 500) return Response.json({ error: "API Key 无效" }, { status: 400 });
    if (!apiKey) {
      const current = await database().prepare("SELECT endpoint, model FROM ai_connections WHERE owner_id = ?").bind(owner).first<{ endpoint: string; model: string }>();
      if (!current || current.endpoint !== endpoint || current.model !== model) return Response.json({ error: "更换接口或模型时请填写 API Key" }, { status: 400 });
      await database().prepare("UPDATE ai_connections SET thinking_mode = ? WHERE owner_id = ?").bind(thinkingMode, owner).run();
      return Response.json({ connected: true, endpoint, model, thinkingMode });
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
