import { env } from "cloudflare:workers";

function bytesToBase64(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function base64ToBytes(value: string) {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

async function encryptionKey(request: Request) {
  let secret = env.MAIMEMO_ENCRYPTION_KEY;
  const host = new URL(request.url).hostname;
  if (!secret && (host === "127.0.0.1" || host === "localhost" || host === "::1")) secret = "lexitrace-local-preview-key";
  if (!secret) throw new Error("凭证保存服务尚未完成安全配置");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(request: Request, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(request), new TextEncoder().encode(value));
  return { encryptedValue: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

export async function decryptSecret(request: Request, encryptedValue: string, iv: string) {
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv) }, await encryptionKey(request), base64ToBytes(encryptedValue));
  return new TextDecoder().decode(decrypted);
}
