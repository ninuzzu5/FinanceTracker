import {
  decideUpdate,
  secretsMatch,
  type TelegramUpdate,
} from "../src/telegram.js";

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

async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  const token = requiredEnv("TELEGRAM_BOT_TOKEN");
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!response.ok) {
    throw new Error(`Telegram sendMessage failed with status ${response.status}`);
  }
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

  const decision = decideUpdate(req.body as TelegramUpdate, {
    allowedChatId: requiredEnv("TELEGRAM_ALLOWED_CHAT_ID"),
    webhookSecret,
  });

  if (decision.kind === "reject" || decision.kind === "preview") {
    await sendTelegramMessage(decision.chatId, decision.reply);
  }

  // Telegram only needs a fast acknowledgement; no personal message is logged.
  res.status(200).json({ ok: true });
}
