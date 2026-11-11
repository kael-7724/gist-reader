import { readSharedSetting, writeSharedSetting } from "@/lib/ai-connection";
import { POOL_OWNER } from "@/lib/daily-picks";
import { encryptSecret } from "@/lib/secret-crypto";
import { message, ownerId } from "@/lib/site-data";

// The site owner's shared DeepSeek key, used by every account that has not connected its own.
function onlyOwner(request: Request) {
  return ownerId(request) === POOL_OWNER ? null : Response.json({ error: "只有管理员可以设置共享 Key" }, { status: 403 });
}

export async function GET(request: Request) {
  try {
    const denied = onlyOwner(request); if (denied) return denied;
    const setting = await readSharedSetting();
    return Response.json(setting ? { configured: true, last4: setting.last4, setAt: setting.setAt } : { configured: false });
  } catch (error) { return Response.json({ error: message(error) }, { status: 500 }); }
}

export async function PUT(request: Request) {
  try {
    const denied = onlyOwner(request); if (denied) return denied;
    const { apiKey } = await request.json() as { apiKey?: string };
    const key = (apiKey || "").trim();
    if (!/^sk-[A-Za-z0-9_-]{16,200}$/.test(key)) return Response.json({ error: "请填写以 sk- 开头的 DeepSeek API Key" }, { status: 400 });
    const check = await fetch("https://api.deepseek.com/models", { headers: { authorization: `Bearer ${key}` }, redirect: "manual" }).catch(() => null);
    if (!check) return Response.json({ error: "暂时连不上 DeepSeek，稍后再试" }, { status: 502 });
    if (check.status === 401 || check.status === 403) return Response.json({ error: "这个 API Key 无效，请检查后重新填写" }, { status: 400 });
    if (!check.ok) return Response.json({ error: `DeepSeek 验证失败（${check.status}）` }, { status: 502 });
    const encrypted = await encryptSecret(request, key);
    const setting = { encryptedApiKey: encrypted.encryptedValue, apiKeyIv: encrypted.iv, last4: key.slice(-4), setAt: new Date().toISOString() };
    await writeSharedSetting(setting);
    return Response.json({ configured: true, last4: setting.last4, setAt: setting.setAt });
  } catch (error) { return Response.json({ error: message(error) }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  try {
    const denied = onlyOwner(request); if (denied) return denied;
    await writeSharedSetting(null);
    return Response.json({ configured: false });
  } catch (error) { return Response.json({ error: message(error) }, { status: 500 }); }
}
