import { database, message, ownerId } from "@/lib/site-data";
import { encryptToken, maimemoRequest } from "@/lib/maimemo";

type ConnectionRow = { encrypted_token: string; token_iv: string; connected_at: string; verified_at: string };

export async function GET(request: Request) {
  try {
    const owner = ownerId(request);
    const row = await database().prepare("SELECT encrypted_token, token_iv, connected_at, verified_at FROM maimemo_connections WHERE owner_id = ?").bind(owner).first<ConnectionRow>();
    if (!row) return Response.json({ connected: false });
    return Response.json({ connected: true, connectedAt: row.connected_at, verifiedAt: row.verified_at });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const owner = ownerId(request);
    const payload = await request.json() as { token?: string };
    const token = payload.token?.trim() || "";
    if (token.length < 16 || token.length > 1000) return Response.json({ error: "请输入有效的墨墨开放 API 凭证" }, { status: 400 });
    await maimemoRequest(token, "/api/v1/memo/notepads?limit=1&offset=0");
    const encrypted = await encryptToken(request, token);
    await database().prepare("INSERT INTO maimemo_connections (owner_id, encrypted_token, token_iv, verified_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(owner_id) DO UPDATE SET encrypted_token = excluded.encrypted_token, token_iv = excluded.token_iv, verified_at = CURRENT_TIMESTAMP").bind(owner, encrypted.encryptedToken, encrypted.tokenIv).run();
    return Response.json({ connected: true });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const owner = ownerId(request);
    await database().prepare("DELETE FROM maimemo_connections WHERE owner_id = ?").bind(owner).run();
    return Response.json({ connected: false });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 500 });
  }
}
