// One JSON-returning chat request to any OpenAI-compatible Chat Completions endpoint
// (DeepSeek, Qwen, Kimi, GLM, OpenAI or a custom one).

export type ChatTarget = { endpoint: string; key: string; model: string; thinkingMode?: string };
type Message = { role: "system" | "user"; content: string };

export function providerName(endpoint: string) {
  const host = new URL(endpoint).hostname;
  if (host.endsWith("deepseek.com")) return "DeepSeek";
  if (host.endsWith("aliyuncs.com")) return "通义千问";
  if (host.includes("moonshot")) return "Kimi";
  if (host.endsWith("bigmodel.cn")) return "智谱";
  if (host.endsWith("openai.com")) return "OpenAI";
  return "AI 接口";
}

// Provider-specific extras; a server that rejects them gets one retry with a plain request.
function extras(target: ChatTarget, temperature: number | undefined, maxTokens: number) {
  const host = new URL(target.endpoint).hostname;
  const thinking = target.thinkingMode === "enabled" ? "enabled" : "disabled";
  const body: Record<string, unknown> = { response_format: { type: "json_object" } };
  if (host.endsWith("deepseek.com") || host.endsWith("bigmodel.cn")) body.thinking = { type: thinking };
  if (host.endsWith("aliyuncs.com")) body.enable_thinking = thinking === "enabled";
  if (host.endsWith("openai.com")) body.max_completion_tokens = maxTokens;
  else { body.max_tokens = maxTokens; if (temperature !== undefined) body.temperature = temperature; }
  return body;
}

function parseObject(content: string, name: string) {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const candidates = [cleaned, cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1)];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* try the next form */ }
  }
  throw new Error(`${name} 没有返回有效的 JSON 结果`);
}

export async function chatJson(target: ChatTarget, messages: Message[], options: { temperature?: number; maxTokens?: number; timeoutMs?: number } = {}) {
  const name = providerName(target.endpoint);
  const maxTokens = options.maxTokens ?? 4096;
  const send = async (plain: boolean) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 45000);
    try {
      return await fetch(target.endpoint, {
        method: "POST", redirect: "manual", signal: controller.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${target.key}` },
        body: JSON.stringify({ model: target.model, stream: false, messages, ...(plain ? {} : extras(target, options.temperature, maxTokens)) }),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error(`${name} 响应超时，请稍后重试`);
      throw new Error(`${name} 暂时无法连接，请稍后重试`);
    } finally { clearTimeout(timer); }
  };
  let response = await send(false);
  if (response.status === 400 || response.status === 422) response = await send(true);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error(`${name} API Key 无效或无权使用这个模型，请检查设置`);
    if (response.status === 402) throw new Error(`${name} 账户余额不足，请充值后重试`);
    if (response.status === 404) throw new Error(`${name} 找不到这个模型或接口地址，请检查设置`);
    if (response.status === 429) throw new Error(`${name} 请求过于频繁或额度不足，请稍后重试`);
    throw new Error(`${name} 请求失败（${response.status}）`);
  }
  const raw = await response.text();
  if (raw.length > 200000) throw new Error(`${name} 返回内容过长`);
  let content: unknown;
  try { content = (JSON.parse(raw) as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content; }
  catch { throw new Error(`${name} 返回的数据格式不兼容 Chat Completions`); }
  if (typeof content !== "string" || !content.trim()) throw new Error(`${name} 没有返回内容`);
  return parseObject(content, name);
}

// Model ids from the provider's /models list, for the settings picker.
export async function listModels(endpoint: string, key: string) {
  const base = endpoint.replace(/\/chat\/completions\/?$/, "").replace(/\/$/, "");
  const response = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${key}` }, redirect: "manual" }).catch(() => null);
  if (!response) throw new Error("暂时连不上这个接口");
  if (response.status === 401 || response.status === 403) throw new Error("API Key 无效");
  if (!response.ok) throw new Error(`这个接口不提供模型列表（${response.status}），请手动填写模型名`);
  const data = await response.json().catch(() => null) as { data?: Array<{ id?: unknown }> } | null;
  const ids = (data?.data ?? []).map((item) => item.id).filter((id): id is string => typeof id === "string" && /^[\w.:/@+-]{1,120}$/.test(id));
  return [...new Set(ids)].sort().slice(0, 300);
}
