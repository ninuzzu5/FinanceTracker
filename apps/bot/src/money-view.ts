/** Display exact decimal strings without Number coercion or rounding. Financial writes are unchanged. */
export function historyCents(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2})0*)?$/.exec(value);
  if (!match) throw new Error('Importo non valido');
  return BigInt(`${match[2]}${(match[3] ?? '').padEnd(2,'0')}`) * (match[1] ? -1n : 1n);
}
export function euro(value: string | number, sign: '' | '+' | '−' = ''): string {
  const cents = historyCents(String(value));
  const absolute = cents < 0n ? -cents : cents;
  return `${sign || (cents < 0n ? '−' : '')}${(absolute / 100n).toLocaleString('it-IT')},${String(absolute % 100n).padStart(2,'0')} €`;
}
