import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProposalFlow } from '../src/proposal-flow.js';
import { deliverUpdate } from '../src/flow-delivery.js';
import { sourceOperationKey } from '../src/operation-key.js';
import type { ManagedDetail } from '../src/management.js';
import { proposalKeyboard } from '../src/proposal-view.js';

const chat = 123456;
const config = { allowedChatId: String(chat) };
const flows: ProposalFlow[] = [];
const message = (text: string, id = 10) => ({
  update_id: id, message: { message_id: id, text, chat: { id: chat, type: 'private' } },
});
const edit = (text: string, id = 90, version = 100) => ({
  update_id: version, edited_message: message(text, id).message,
});
const detail: ManagedDetail = {
  movement: { id: 'movement', type: 'expense', amount: '12.50', date: '2026-10-09',
    category: 'food', from_id: 'bank', to_id: null, version: '1', voided_at: null, voided_by: null },
  accounts: [{ id: 'bank', name: 'Revolut', currency: 'EUR', active: true }],
};
function fixture() {
  const flow = new ProposalFlow();
  flows.push(flow);
  let sent = 200;
  const client = { call: vi.fn().mockResolvedValue(true), sendMessage: vi.fn(async () => ++sent) };
  const repo = { getTransactionReceipt: vi.fn().mockResolvedValue(null), saveTransaction: vi.fn().mockResolvedValue({ id: 'saved' }) };
  const cash = { previewCash: vi.fn().mockResolvedValue({ accountId: 'cash', theoretical: '12.00' }),
    reconcileCash: vi.fn().mockResolvedValue({ id: 'adjustment', observed: '12.00', delta: '0.00' }) };
  const history = { getMovements: vi.fn().mockResolvedValue({ rows: [{ id: 'movement', type: 'expense', amount: '12.50',
    date: '2026-10-09', category: 'food', from: 'Revolut', to: null }], next: null }) };
  const balances = { getBalances: vi.fn().mockResolvedValue([]) };
  const management = { getMovement: vi.fn(async () => structuredClone(detail)),
    changeMovement: vi.fn(), getChangeReceipt: vi.fn().mockResolvedValue(null) };
  const deliver = (update: unknown, target = flow) => deliverUpdate(target, client, update, config, undefined, repo, cash, history, balances, management);
  const button = (action: string) => {
    const state = flow.store.getState(chat)!;
    const prefix = state.kind === 'proposal' ? 'p' : state.kind === 'management' ? 'c' : state.kind === 'wizard' ? 'w'
      : state.kind === 'menu' ? 'm' : state.kind === 'history' ? 'h' : 'r';
    const id = state.kind === 'proposal' ? state.proposal.id : state.id;
    const revision = state.kind === 'proposal' ? state.proposal.revision : 'revision' in state ? state.revision : 0;
    const data = state.kind === 'proposal' && action === 'confirm'
      ? proposalKeyboard(state.proposal).inline_keyboard[0][0].callback_data
      : prefix === 'm' ? `${prefix}:${id}:${action}` : `${prefix}:${id}:${revision}:${action}`;
    return { update_id: 500, callback_query: { id: 'query', from: { id: chat }, data,
      message: { message_id: flow.panels.get(chat)?.messageId ?? sent, chat: { id: chat, type: 'private' } } } };
  };
  const click = (action: string) => deliver(button(action));
  const start = async (kind: string) => {
    if (kind === 'cash') {
      await deliver(message('/riconcilia')); await click('today');
    } else if (kind.startsWith('management')) {
      await deliver(message('/movimenti')); await click('select.0'); await click('edit');
      await click(kind.endsWith('date') ? 'field.date' : 'field.amount');
    } else if (kind.startsWith('wizard')) {
      await deliver(message('/menu')); await click('movement'); await click('type.expense');
      if (kind.endsWith('date')) {
        await deliver(message('12', 11)); await click('category.food'); await click('account.revolut'); await click('date.custom');
      }
    } else {
      await deliver(message('12 pranzo revolut')); await click('field.amount');
    }
  };
  return { flow, client, repo, cash, management, deliver, button, click, start };
}
afterEach(() => { flows.splice(0).forEach(flow => flow.store.clear()); vi.restoreAllMocks(); });

describe('UX-01 — edited messages are not field replies', () => {
  it.each(['cash', 'management-amount', 'management-date', 'wizard-amount', 'wizard-date', 'proposal'])(
    'leaves the complete %s state, source ordering and panel unchanged', async kind => {
      const s = fixture(); await s.start(kind);
      const state = s.flow.store.getState(chat);
      const snapshot = structuredClone(state);
      const panel = s.flow.panels.get(chat);
      const versions = [...s.flow.sourceVersions];
      const latest = s.flow.latestSourceId;
      s.client.call.mockClear(); s.client.sendMessage.mockClear();
      for (const text of ['99', '10/10/2026', '99 pranzo contanti', '/cancel', '/menu', '/help', '/saldi', '/riconcilia']) {
        await s.deliver(edit(text));
        expect(s.flow.store.getState(chat)).toBe(state);
        expect(state).toEqual(snapshot);
        expect(s.flow.panels.get(chat)).toBe(panel);
        expect([...s.flow.sourceVersions]).toEqual(versions);
        expect(s.flow.latestSourceId).toBe(latest);
      }
      expect(s.client.call).not.toHaveBeenCalled(); expect(s.client.sendMessage).not.toHaveBeenCalled();
      expect(s.repo.saveTransaction).not.toHaveBeenCalled(); expect(s.cash.reconcileCash).not.toHaveBeenCalled();
      expect(s.management.changeMovement).not.toHaveBeenCalled();
      // Ignoring a high message ID must not suppress the next legitimate reply.
      await s.deliver(message(kind.endsWith('date') ? '10/10/2026' : '13', 12));
      expect(s.flow.store.getState(chat)).not.toEqual(snapshot);
    },
  );

  it('also rejects unrelated edits at the synchronous flow boundary', async () => {
    const s = fixture(); await s.start('cash');
    const snapshot = structuredClone(s.flow.store.getState(chat));
    expect(s.flow.handle(edit('99'), config)).toEqual([]);
    expect(s.flow.store.getState(chat)).toEqual(snapshot);
  });

  it('ignores late edits without receipts after a restart, with or without a new flow', async () => {
    const s = fixture(); await s.deliver(message('12 pranzo revolut'));
    const restarted = new ProposalFlow(); flows.push(restarted);
    await s.deliver(edit('99 pranzo revolut', 10), restarted);
    expect(restarted.store.getState(chat)).toBeUndefined();
    expect(restarted.sourceVersions.size).toBe(0);
    await s.deliver(message('/riconcilia', 11), restarted);
    const state = structuredClone(restarted.store.getState(chat));
    await s.deliver(edit('99', 10), restarted);
    expect(restarted.store.getState(chat)).toEqual(state);
    expect(s.repo.getTransactionReceipt).toHaveBeenCalledWith(sourceOperationKey(chat, 10));
    expect(s.repo.saveTransaction).not.toHaveBeenCalled();
  });

  it('does not revive a known source without a receipt after cancellation', async () => {
    const s = fixture(); await s.deliver(message('12 pranzo revolut')); await s.click('cancel');
    await s.deliver(edit('99 pranzo revolut', 10));
    expect(s.flow.store.getState(chat)).toBeUndefined();
    expect(s.repo.saveTransaction).not.toHaveBeenCalled();
  });

  it('does not restore a source superseded while its receipt lookup is pending', async () => {
    const s = fixture(); await s.deliver(message('12 pranzo revolut'));
    let finish!: (value: null) => void;
    s.repo.getTransactionReceipt.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = s.deliver(edit('99 pranzo revolut', 10));
    await s.start('cash'); const snapshot = structuredClone(s.flow.store.getState(chat));
    const versions = [...s.flow.sourceVersions];
    finish(null); await pending;
    expect(s.flow.store.getState(chat)).toEqual(snapshot);
    expect([...s.flow.sourceVersions]).toEqual(versions);
  });

  it('reparses the active source, rejects old callbacks and preserves its operation key', async () => {
    const s = fixture(); await s.deliver(message('12 pranzo revolut'));
    const stale = s.button('confirm'); const requestId = s.flow.store.get(chat)!.requestId;
    await s.deliver(edit('13 pranzo contanti', 10));
    const proposal = s.flow.store.get(chat)!;
    expect(proposal).toMatchObject({ amount: 13, account: 'contanti', requestId });
    await s.deliver(stale); expect(s.repo.saveTransaction).not.toHaveBeenCalled();
    await s.deliver(edit('14 pranzo contanti', 10, 99)); expect(s.flow.store.get(chat)).toBe(proposal);
    await s.click('confirm'); expect(s.repo.saveTransaction).toHaveBeenCalledTimes(1);
    expect(s.repo.saveTransaction.mock.calls[0][1]).toBe(requestId);
    s.repo.getTransactionReceipt.mockResolvedValue({ id: 'saved' });
    await s.deliver(edit('99 pranzo contanti', 10, 101));
    expect(s.flow.store.getState(chat)).toBeUndefined(); expect(s.repo.saveTransaction).toHaveBeenCalledTimes(1);
    const restarted = new ProposalFlow(); flows.push(restarted);
    await s.deliver(edit('99 pranzo contanti', 10, 102), restarted);
    expect(restarted.store.getState(chat)).toBeUndefined(); expect(restarted.sourceVersions.size).toBe(0);
    expect(s.repo.saveTransaction).toHaveBeenCalledTimes(1);
  });

  it('recovers a saved source receipt after restart without changing a different active flow', async () => {
    const s = fixture(); await s.start('cash'); const snapshot = structuredClone(s.flow.store.getState(chat));
    const panel = s.flow.panels.get(chat);
    s.repo.getTransactionReceipt.mockResolvedValue({ id: 'saved' });
    await s.deliver(edit('99', 1));
    expect(s.flow.store.getState(chat)).toEqual(snapshot); expect(s.flow.panels.get(chat)).toBe(panel);
    expect(s.client.sendMessage).toHaveBeenLastCalledWith(chat, expect.stringContaining('già registrato'), undefined, undefined);
    expect(s.repo.saveTransaction).not.toHaveBeenCalled();
  });

  it('preserves frozen values and the retry key after unrelated edits', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = fixture(); await s.deliver(message('12 pranzo revolut'));
    s.repo.saveTransaction.mockRejectedValueOnce(new Error('synthetic timeout'));
    await s.click('confirm'); const snapshot = structuredClone(s.flow.store.getState(chat));
    await s.deliver(edit('99 pranzo contanti'));
    expect(s.flow.store.getState(chat)).toEqual(snapshot);
    await s.click('confirm');
    expect(s.repo.saveTransaction.mock.calls[1][1]).toBe(s.repo.saveTransaction.mock.calls[0][1]);
    expect(s.repo.saveTransaction.mock.calls[1][0]).toMatchObject({
      amount: 12, account: 'revolut', date: s.repo.saveTransaction.mock.calls[0][0].date,
      requestId: s.repo.saveTransaction.mock.calls[0][1],
    });
  });

  it('does not consume edits of the menu root or previous replies as wizard fields', async () => {
    const s = fixture(); await s.start('wizard-date');
    const snapshot = structuredClone(s.flow.store.getState(chat));
    await s.deliver(edit('10/10/2026', 10));
    await s.deliver(edit('10/10/2026', 11, 101));
    expect(s.flow.store.getState(chat)).toEqual(snapshot);
  });

  it.each(['invalid text', '/help'])('invalidates a guided proposal when its root becomes %s', async text => {
    const s = fixture(); await s.start('wizard-amount');
    await s.deliver(message('12', 11)); await s.click('category.food'); await s.click('account.revolut'); await s.click('date.today');
    const old = s.button('confirm');
    expect(s.flow.store.get(chat)?.sourceMessageId).toBeNull();
    await s.deliver(edit(text, 10)); await s.deliver(old);
    expect(s.flow.store.getState(chat)).toBeUndefined(); expect(s.repo.saveTransaction).not.toHaveBeenCalled();
  });

  it('freezes a guided proposal against edits of its root after an uncertain save', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = fixture(); await s.start('wizard-amount');
    await s.deliver(message('12', 11)); await s.click('category.food'); await s.click('account.revolut'); await s.click('date.today');
    s.repo.saveTransaction.mockRejectedValueOnce(new Error('synthetic timeout')); await s.click('confirm');
    const snapshot = structuredClone(s.flow.store.getState(chat));
    await s.deliver(edit('99 pranzo contanti', 10));
    await s.deliver(edit('/help', 10, 101));
    expect(s.flow.store.getState(chat)).toEqual(snapshot);
    await s.click('confirm');
    expect(s.repo.saveTransaction.mock.calls[1][1]).toBe(s.repo.saveTransaction.mock.calls[0][1]);
    expect(s.repo.saveTransaction.mock.calls[1][0]).toMatchObject({ amount: 12, account: 'revolut' });
  });
});
