import {
  secretsMatch,
} from "../src/telegram.js";
import { readBotConfig } from "../src/config.js";
import { TelegramClient } from "../src/transport.js";
import { ProposalFlow } from "../src/proposal-flow.js";
import { deliverUpdate } from "../src/flow-delivery.js";

// Best-effort warm-process memory only; polling is the supported local workflow.
const flow = new ProposalFlow();
let pending: Promise<void> = Promise.resolve();

interface ServerlessRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

interface ServerlessResponse {
  setHeader(name: string, value: string): void;
  status(code: number): ServerlessResponse;
  json(body: unknown): void;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export default async function handler(
  req: ServerlessRequest,
  res: ServerlessResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ ok: false });
    return;
  }

  const webhookSecret = requiredEnv("TELEGRAM_WEBHOOK_SECRET");
  const receivedSecret = req.headers["x-telegram-bot-api-secret-token"];
  const normalizedSecret = Array.isArray(receivedSecret) ? receivedSecret[0] : receivedSecret;

  if (!secretsMatch(normalizedSecret, webhookSecret)) {
    res.status(401).json({ ok: false });
    return;
  }

  const config = readBotConfig();
  const delivery = pending.then(() => deliverUpdate(flow,
    new TelegramClient(config.token, { maxAttempts: 1, timeoutMs: 2000 }), req.body,
    { allowedChatId: config.allowedChatId, messageConfig: config }));
  pending = delivery.catch(() => {});
  await delivery;

  // Telegram only needs a fast acknowledgement; no personal message is logged.
  res.status(200).json({ ok: true });
}
