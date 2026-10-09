import { createHash } from "node:crypto";

// Versioned opaque source identity. No text, financial values or raw Telegram IDs stored in SQL.
// Namespace contract: one Telegram bot per Supabase owner; do not change after rollout.
export function sourceOperationKey(chatId: number, messageId: number): string {
  const bytes = createHash("sha256").update(`financetracker:telegram:v1:${chatId}:${messageId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80; // UUIDv8, SHA-256-derived application identifier.
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return uuidFromBytes(bytes);
}
function uuidFromBytes(bytes: Buffer): string {
  const hex = bytes.toString("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function compactOperationKey(key: string): string {
  return Buffer.from(key.replaceAll("-", ""), "hex").toString("base64url");
}
export function expandOperationKey(value: string): string | null {
  if (!/^[A-Za-z0-9_-]{22}$/.test(value)) return null;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 16 && bytes.toString("base64url") === value ? uuidFromBytes(bytes) : null;
}
