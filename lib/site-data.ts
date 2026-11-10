import { env } from "cloudflare:workers";

export function database() {
  if (!env.DB) throw new Error("学习资料库暂时不可用");
  return env.DB;
}

export function ownerId(request: Request) {
  const id = request.headers.get("oai-authenticated-user-id");
  const host = new URL(request.url).hostname;
  if (!id && (host === "127.0.0.1" || host === "localhost" || host === "::1")) return "local-preview-user";
  if (!id) throw new Error("请先登录后使用资料库");
  return id;
}

export function message(error: unknown) {
  return error instanceof Error ? error.message : "请求处理失败";
}
