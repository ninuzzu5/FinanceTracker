import { loadEnvFile } from "node:process";
import { ConfigurationError, readBotConfig } from "./config.js";
import { runPolling } from "./polling.js";
import { TelegramClient, TelegramError } from "./transport.js";

const controller = new AbortController();
const stop = () => controller.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

try {
  try {
    // Native Node loader; existing shell environment variables take precedence.
    loadEnvFile(".env.local");
  } catch {
    throw new ConfigurationError("Impossibile caricare .env.local dalla root. Crea o controlla il file privato prima di avviare il bot.");
  }
  const config = readBotConfig();
  const client = new TelegramClient(config.token, {
    onRetry: () => console.warn("Telegram non raggiungibile o temporaneamente occupato: nuovo tentativo dopo una pausa."),
  });
  await runPolling(client, config, controller.signal, {
    onReady: () => console.log("Bot locale attivo. Scrivi su Telegram; Ctrl+C per arrestare. I movimenti vengono salvati solo dopo conferma."),
  });
} catch (error) {
  if (!controller.signal.aborted) {
    console.error(error instanceof ConfigurationError || error instanceof TelegramError
      ? error.message : "Avvio o esecuzione del bot non riusciti. Controlla la configurazione e riprova.");
    process.exitCode = 1;
  }
} finally {
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  if (controller.signal.aborted) console.log("Bot locale arrestato.");
}
