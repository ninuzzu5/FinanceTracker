export const telegramCommands = [
  { command: 'start', description: 'Avvia FinanceTracker' },
  { command: 'menu', description: 'Apri il menu principale' },
  { command: 'movimenti', description: 'Visualizza gli ultimi movimenti' },
  { command: 'riconcilia', description: 'Riconcilia i contanti' },
  { command: 'help', description: 'Mostra la guida' },
  { command: 'cancel', description: "Annulla l'operazione" },
] as const;
export function commandName(text: string): string | null {
  const match = /^\/([a-z]+)(?:@niuzzu_bot)?(?:\s|$)/i.exec(text.trim());
  return match && telegramCommands.some(c => c.command === match[1].toLowerCase()) ? match[1].toLowerCase() : null;
}
export async function registerCommands(client: { call: (method: 'setMyCommands', body: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown> }, chatId: string, signal?: AbortSignal): Promise<void> {
  try { await client.call('setMyCommands', { commands: telegramCommands, scope: { type: 'chat', chat_id: chatId } }, signal); }
  catch { signal?.throwIfAborted(); console.warn('Menu comandi Telegram non aggiornato. Il bot continua a funzionare; riprova al prossimo avvio.'); }
}
