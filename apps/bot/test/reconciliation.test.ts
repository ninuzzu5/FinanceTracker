import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProposalStore } from '../src/proposals.js';
import { ProposalFlow } from '../src/proposal-flow.js';
import { deliverUpdate } from '../src/flow-delivery.js';
import { cashInput, decimalCents, centsDecimal, ReconciliationError } from '../src/reconciliation.js';

const chatId = 123456;
const config = { allowedChatId: String(chatId) };
const message = (text: string) => ({ update_id: 1, message: { message_id: 1, text, chat: { id: chatId, type: 'private' } } });
const callback = (flow: ProposalFlow, action: string) => {
  const state = flow.store.getState(chatId)!;
  if (state.kind !== 'reconciliation') throw new Error('Expected cash state');
  return { update_id: 2, callback_query: { id: 'synthetic', from: { id: chatId }, data: `r:${state.id}:${state.revision}:${action}`, message: { message_id: 2, chat: { id: chatId, type: 'private' } } } };
};
const flows: ProposalFlow[] = [];
const setup = () => {
  const flow = new ProposalFlow(); flows.push(flow);
  const client = { call: vi.fn().mockResolvedValue(true), sendMessage: vi.fn().mockResolvedValue(undefined) };
  const transaction = { saveTransaction: vi.fn() };
  const cash = { previewCash: vi.fn().mockResolvedValue({ accountId: 'synthetic-cash', theoretical: '10.29' }), reconcileCash: vi.fn().mockResolvedValue({ id: 'synthetic-receipt', delta: '-0.29', observed: '10.00' }) };
  const deliver = (update: unknown) => deliverUpdate(flow, client, update, config, undefined, transaction, cash);
  const start = async () => { await deliver(message('/riconcilia')); await deliver(callback(flow, 'today')); await deliver(message('10')); };
  return { flow, client, cash, transaction, deliver, start };
};
afterEach(() => { flows.splice(0).forEach(f => f.store.clear()); vi.useRealTimers(); });

describe('exact cash input', () => {
  it.each(['0', '0,00', '€0', '0 EUR'])('accepts zero %s', text => expect(cashInput(text)).toBe('0.00'));
  it.each(['-1', '12,345', '1 2', '10 nota', 'NaN'])('rejects %s', text => expect(cashInput(text)).toBeNull());
  it('preserves cents and large theoretical amounts with BigInt', () => {
    expect(cashInput('12,50')).toBe('12.50');
    expect(centsDecimal(decimalCents('9007199254740992.29') - decimalCents('9007199254740992.30'))).toBe('-0.01');
  });
});
describe('Telegram reconciliation', () => {
  it('reads Contanti, previews without writes, confirms a separate adjustment', async () => {
    const s = setup(); await s.start();
    expect(s.cash.previewCash).toHaveBeenCalledTimes(1);
    expect(s.cash.reconcileCash).not.toHaveBeenCalled();
    expect(s.transaction.saveTransaction).not.toHaveBeenCalled();
    expect(s.client.sendMessage.mock.calls.at(-1)?.[1]).toContain('Rettifica: -0.29');
    const confirm = callback(s.flow, 'confirm'); await s.deliver(confirm); await s.deliver(confirm);
    expect(s.cash.reconcileCash).toHaveBeenCalledTimes(1);
    expect(s.cash.reconcileCash.mock.calls[0][0]).toMatchObject({ accountId: 'synthetic-cash', expected: '10.29', observed: '10.00', requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(s.flow.store.getState(chatId)).toBeUndefined();
    expect(s.client.sendMessage.mock.calls.at(-1)?.[1]).toContain('Giornata chiusa');
  });
  it('keeps invalid input at amount, accepts zero, edits and cancels without writing', async () => {
    const s = setup(); await s.deliver(message('/riconcilia')); await s.deliver(callback(s.flow, 'yesterday'));
    await s.deliver(message('-1')); expect(s.flow.store.getState(chatId)).toMatchObject({ step: 'amount' });
    await s.deliver(message('0')); expect(s.flow.store.getState(chatId)).toMatchObject({ observed: '0.00' });
    await s.deliver(callback(s.flow, 'edit')); await s.deliver(message('12,50')); await s.deliver(callback(s.flow, 'cancel'));
    expect(s.cash.reconcileCash).not.toHaveBeenCalled();
    expect(s.flow.store.getState(chatId)).toBeUndefined();
  });
  it.each(['unconfigured', 'closed', 'account'] as const)('blocks %s before requesting money', async code => {
    const s = setup(); s.cash.previewCash.mockRejectedValue(new ReconciliationError(code));
    await s.deliver(message('/riconcilia')); await s.deliver(callback(s.flow, 'today'));
    expect(s.flow.store.getState(chatId)).toBeUndefined(); expect(s.cash.reconcileCash).not.toHaveBeenCalled();
  });
  it('blocks parallel confirms and commands while saving', async () => {
    const s = setup(); await s.start();
    let finish!: (value: { id: string; delta: string; observed: string }) => void;
    s.cash.reconcileCash.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const confirm = callback(s.flow, 'confirm'); const pending = s.deliver(confirm);
    await vi.waitFor(() => expect(s.cash.reconcileCash).toHaveBeenCalledTimes(1));
    await s.deliver(confirm); await s.deliver(message('/cancel')); await s.deliver(message('/riconcilia'));
    expect(s.cash.reconcileCash).toHaveBeenCalledTimes(1);
    finish({ id: 'synthetic', delta: '-0.29', observed: '10.00' }); await pending;
  });
  it('retries unknown outcomes with identical payload/key, freezes edits and closes on success', async () => {
    const s = setup(); await s.start();
    s.cash.reconcileCash.mockRejectedValueOnce(new Error('private sdk details'));
    await s.deliver(callback(s.flow, 'confirm'));
    expect(s.flow.store.getState(chatId)).toMatchObject({ step: 'uncertain' });
    await s.deliver(callback(s.flow, 'edit')); await s.deliver(message('20'));
    await s.deliver(callback(s.flow, 'confirm'));
    expect(s.cash.reconcileCash.mock.calls[1][0]).toEqual(s.cash.reconcileCash.mock.calls[0][0]);
    expect(s.client.sendMessage.mock.calls.some(([, text]) => text.includes('private sdk'))).toBe(false);
  });
  it('cancels an uncertain flow without claiming to void the database adjustment', async () => {
    const s = setup(); await s.start(); s.cash.reconcileCash.mockRejectedValue(new ReconciliationError('unknown'));
    await s.deliver(callback(s.flow, 'confirm')); await s.deliver(message('/cancel'));
    expect(s.client.sendMessage.mock.calls.at(-1)?.[1]).toContain('non ho annullato');
  });
  it('does not replay persistence if success delivery to Telegram fails', async () => {
    const s = setup(); await s.start(); const confirm = callback(s.flow, 'confirm');
    s.client.sendMessage.mockRejectedValueOnce(new Error('Telegram unavailable'));
    await expect(s.deliver(confirm)).rejects.toThrow('Telegram unavailable'); await s.deliver(confirm);
    expect(s.cash.reconcileCash).toHaveBeenCalledTimes(1); expect(s.flow.store.getState(chatId)).toBeUndefined();
  });
  it('expires previews without persisting and resolves dates in Rome', () => {
    let time = 0;
    const flow = new ProposalFlow(new ProposalStore(1000, () => time)); flows.push(flow);
    flow.handle(message('/riconcilia'), config);
    const today = flow.handle(callback(flow, 'today'), config, new Date('2026-01-01T23:30:00Z'));
    expect(today).toContainEqual(expect.objectContaining({kind:'loadCash',date:'2026-01-02'}));
    flow.completeCashLoad(today.find(e => e.kind === 'loadCash')!, {accountId:'synthetic',theoretical:'0.00'});
    flow.handle(message('0'), config);
    const confirm = callback(flow, 'confirm'); time = 1001;
    expect(flow.handle(confirm, config).some(e => e.kind === 'reconcileCash')).toBe(false);
    expect(flow.store.getState(chatId)).toBeUndefined();
  });
  it('reports a changed balance without retrying an obsolete confirmation', async () => {
    const s=setup(); await s.start();s.cash.reconcileCash.mockRejectedValue(new ReconciliationError('changed'));
    const confirm=callback(s.flow,'confirm');await s.deliver(confirm);await s.deliver(confirm);
    expect(s.cash.reconcileCash).toHaveBeenCalledTimes(1);
    expect(s.flow.store.getState(chatId)).toBeUndefined();
    expect(s.client.sendMessage.mock.calls.at(-1)?.[1]).toContain('nuova anteprima');
  });
  it('invalidates obsolete callbacks and rejects unauthorized users', async () => {
    const s = setup(); await s.deliver(message('/riconcilia')); const old = callback(s.flow, 'today');
    await s.deliver(message('/riconcilia')); await s.deliver(old); expect(s.cash.previewCash).not.toHaveBeenCalled();
    const unauthorized = callback(s.flow, 'today'); unauthorized.callback_query.from.id = 999;
    await s.deliver(unauthorized); expect(s.cash.previewCash).not.toHaveBeenCalled();
  });
});
