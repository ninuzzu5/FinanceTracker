import { afterEach, describe, expect, it, vi } from 'vitest';
import { SupabaseTransactionRepository, boundedSupabaseFetch } from '../src/supabase.js';
const sdk = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: sdk.createClient }));
const request = {accountId:'synthetic-account',date:'2026-01-01',observed:'12.29',expected:'12.30',requestId:'synthetic-key'};
function setup(data: unknown = [{adjustment_id:'synthetic-adjustment',delta:'-0.01',observed_balance:'12.29'}], code?: string) {
  const user = {id:'synthetic-user'};
  const client = { auth: {
    getSession: vi.fn().mockResolvedValue({data:{session:{user,access_token:'synthetic-token',expires_at:Date.now()/1000+3600}},error:null}),
    getUser: vi.fn().mockResolvedValue({data:{user},error:null}),
  }, rpc: vi.fn().mockResolvedValue({data,error:code ? {code,message:'private SDK details'} : null}),from:vi.fn() };
  sdk.createClient.mockReturnValue(client);
  return {client,repository:new SupabaseTransactionRepository(() => ({url:'https://synthetic.invalid',anonKey:'synthetic-public',email:'test@example.invalid',password:'synthetic'}))};
}
afterEach(() => {vi.restoreAllMocks();vi.unstubAllGlobals();sdk.createClient.mockReset();});
describe('cash RPC persistence', () => {
  it('uses exact decimal strings, expected balance and durable request key, without inserting transactions', async () => {
    const {client,repository} = setup();
    await expect(repository.reconcileCash(request)).resolves.toEqual({id:'synthetic-adjustment',delta:'-0.01',observed:'12.29'});
    expect(client.rpc).toHaveBeenCalledWith('reconcile_cash',{p_account_id:request.accountId,p_date:request.date,p_observed:'12.29',p_expected:'12.30',p_request_id:request.requestId});
    expect(client.from).not.toHaveBeenCalled();
    await repository.reconcileCash(request);
    expect(client.rpc.mock.calls[0]).toEqual(client.rpc.mock.calls[1]);
  });
  it('reads a negative theoretical balance without floating point conversion', async () => {
    const {repository,client} = setup([{account_id:request.accountId,theoretical_balance:'-90071992547409.93'}]);
    await expect(repository.previewCash(request.date)).resolves.toEqual({accountId:request.accountId,theoretical:'-90071992547409.93'});
    expect(client.rpc).toHaveBeenCalledWith('preview_cash_reconciliation',{p_date:request.date});
  });
  it.each([['PT412','unconfigured'],['PT423','closed'],['PT409','changed'],['PT404','account'],['42501','access'],['22023','invalid'],['XX000','unknown']])('maps %s to a safe %s error',async (code,safe) => {
    const {repository}=setup(null,code);
    await expect(repository.reconcileCash(request)).rejects.toMatchObject({code:safe,message:`Cash reconciliation failed: ${safe}`});
  });
  it.each([null,[],[{adjustment_id:'id',delta:0,observed_balance:'12.29'}],[{adjustment_id:'id',delta:'NaN',observed_balance:'12.29'}],[{adjustment_id:'id',delta:'0.01',observed_balance:'12.29'}]])('keeps malformed post-write receipts uncertain',async data => {
    const {repository}=setup(data);
    await expect(repository.reconcileCash(request)).rejects.toMatchObject({code:'unknown'});
  });
  it('network failure is uncertain and preserves caller payload',async () => {
    const {repository,client}=setup();client.rpc.mockRejectedValue(new Error('private network details'));
    await expect(repository.reconcileCash(request)).rejects.toMatchObject({code:'unknown'});
    expect(request.observed).toBe('12.29');
  });
  it('rejects negative or sub-cent observed balances before any RPC',async () => {
    const {repository,client}=setup();
    for (const observed of ['-1.00','0.001']) await expect(repository.reconcileCash({...request,observed})).rejects.toMatchObject({code:'invalid'});
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it('refuses a session whose verified identity differs',async () => {
    const {repository,client}=setup();client.auth.getUser.mockResolvedValue({data:{user:{id:'other-user'}},error:null});
    await expect(repository.reconcileCash(request)).rejects.toMatchObject({code:'access'});
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it('bounds HTTP requests and preserves caller cancellation',async () => {
    const timeout = new AbortController(), caller = new AbortController();
    const timeoutSpy=vi.spyOn(AbortSignal,'timeout').mockReturnValue(timeout.signal);
    const fetchMock=vi.fn().mockResolvedValue(new Response());vi.stubGlobal('fetch',fetchMock);
    await boundedSupabaseFetch('https://synthetic.invalid',{signal:caller.signal});
    expect(timeoutSpy).toHaveBeenCalledWith(15000);
    const usedSignal=fetchMock.mock.calls[0][1].signal as AbortSignal;
    expect(usedSignal.aborted).toBe(false);timeout.abort();expect(usedSignal.aborted).toBe(true);
  });
});
