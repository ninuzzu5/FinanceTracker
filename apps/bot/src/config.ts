import { accountIds, type AccountId } from "@finance-tracker/domain";

export interface MessageConfig {
  timeZone: string;
  defaultAccount: AccountId;
}

export interface BotConfig extends MessageConfig {
  token: string;
  allowedChatId: string;
}

export class ConfigurationError extends Error {}

export function readMessageConfig(env: NodeJS.ProcessEnv = process.env): MessageConfig {
  const timeZone = env.APP_TIMEZONE ?? "Europe/Rome";
  try {
    new Intl.DateTimeFormat("it-IT", { timeZone }).format();
  } catch {
    throw new ConfigurationError("APP_TIMEZONE non valida: usa un fuso come Europe/Rome.");
  }
  const defaultAccount = env.DEFAULT_ACCOUNT ?? "revolut";
  if (!accountIds.includes(defaultAccount as AccountId)) {
    throw new ConfigurationError("DEFAULT_ACCOUNT non valido: usa revolut oppure isybank.");
  }
  return { timeZone, defaultAccount: defaultAccount as AccountId };
}

export function readBotConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
    throw new ConfigurationError("TELEGRAM_BOT_TOKEN mancante o non valido: controlla .env.local.");
  }
  const allowedChatId = env.TELEGRAM_ALLOWED_CHAT_ID;
  if (!allowedChatId || !/^[1-9]\d*$/.test(allowedChatId) || !Number.isSafeInteger(Number(allowedChatId))) {
    throw new ConfigurationError("TELEGRAM_ALLOWED_CHAT_ID mancante o non valido: serve l'ID di una chat privata.");
  }
  return { token, allowedChatId, ...readMessageConfig(env) };
}
