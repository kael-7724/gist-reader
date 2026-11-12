import { validateAiEndpoint } from "@/lib/ai";
import { listModels } from "@/lib/ai-request";
import { decryptSecret } from "@/lib/secret-crypto";
import { database, message, ownerId } from "@/lib/site-data";

// The models a provider offers, read with the key just typed or the account's saved key for the same address.
export async function POST(request: Request) {
  try {
    const data = await request.json() as { endpoint?: string; apiKey?: string };
    const endpoint = validateAiEndpoint((data.endpoint || "").trim());
    let key = (data.apiKey || "").trim();
    if (!key) {
      const row = await database().prepare("SELECT endpoint, encrypted_api_key AS encryptedApiKey, api_key_iv AS apiKeyIv FROM ai_connections WHERE owner_id = ?")
        .bind(ownerId(request)).first<{ endpoint: string; encryptedApiKey: string; apiKeyIv: string }>();
      if (!row || row.endpoint !== endpoint) return Response.json({ error: "先填 API Key 再获取模型列表" }, { status: 400 });
      key = await decryptSecret(request, row.encryptedApiKey, row.apiKeyIv);
    }
    return Response.json({ models: await listModels(endpoint, key) });
  } catch (error) { return Response.json({ error: message(error) }, { status: 400 }); }
}
