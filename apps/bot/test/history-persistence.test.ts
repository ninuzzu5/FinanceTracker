import {afterEach,describe,expect,it,vi} from 'vitest';
import {SupabaseTransactionRepository} from '../src/supabase.js';
const user='00000000-0000-4000-8000-000000000001';
const id=(n:number)=>`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const row=(n:number)=>({id:id(n),type:'expense',amount:'12.500',transaction_date:'2026-10-09',category:'food',from_account:{name:'Revolut',currency:'EUR'},to_account:null});
function fixture(rows:unknown[],error?:unknown) {
 const query={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),limit:vi.fn().mockReturnThis(),or:vi.fn().mockReturnThis(),then:(resolve:(v:unknown)=>void)=>resolve({data:rows,error})};
 const sdk={from:vi.fn(()=>query),rpc:vi.fn(),auth:{getSession:vi.fn().mockResolvedValue({data:{session:{user:{id:user},access_token:'synthetic',expires_at:Date.now()/1000+3600}},error:null}),getUser:vi.fn().mockResolvedValue({data:{user:{id:user}},error:null})}};
 const repo=new SupabaseTransactionRepository(()=>({url:'https://synthetic.invalid',anonKey:'synthetic',email:'test@example.invalid',password:'synthetic'}),(()=>sdk) as never);
 return {repo,sdk,query};
}
afterEach(()=>vi.restoreAllMocks());
describe('read-only history repository',()=>{
 it('queries six rows once with owner filter and stable date/UUID order, returns five plus cursor',async()=>{
  const s=fixture([6,5,4,3,2,1].map(row));const page=await s.repo.getMovements(null);
  expect(page.rows.map(r=>r.id)).toEqual([6,5,4,3,2].map(id));expect(page.next).toEqual({date:'2026-10-09',id:id(2)});
  expect(s.sdk.from).toHaveBeenCalledWith('transactions');expect(s.query.eq).toHaveBeenCalledWith('user_id',user);
  expect(s.query.order.mock.calls).toEqual([['transaction_date',{ascending:false}],['id',{ascending:false}]]);
  expect(s.query.limit).toHaveBeenCalledWith(6);expect(s.query.select.mock.calls[0][0]).toContain('amount::text');
  expect(s.query.select.mock.calls[0][0]).not.toContain('description');expect(s.sdk.rpc).not.toHaveBeenCalled();
 });
 it('applies a strict database cursor, not offset or client-side slicing of the full ledger',async()=>{
  const s=fixture([row(1)]);const cursor={date:'2026-10-09',id:id(2)};const page=await s.repo.getMovements(cursor);
  expect(s.query.or).toHaveBeenCalledWith(`transaction_date.lt.2026-10-09,and(transaction_date.eq.2026-10-09,id.lt.${id(2)})`);expect(page.next).toBeNull();
 });
 it('preserves a single transfer with both embedded owned accounts',async()=>{
  const s=fixture([{...row(1),type:'transfer',category:null,to_account:{name:'Contanti',currency:'EUR'}}]);
  expect((await s.repo.getMovements(null)).rows).toEqual([expect.objectContaining({type:'transfer',from:'Revolut',to:'Contanti'})]);
 });
 it('handles no transactions and protects credentials in errors',async()=>{
  expect(await fixture([]).repo.getMovements(null)).toEqual({rows:[],next:null});
  await expect(fixture([],{code:'private',message:'credentials'}).repo.getMovements(null)).rejects.toMatchObject({message:'Transaction persistence failed: accounts_query'});
 });
 it.each([{date:'infinity',id:id(1)},{date:'2026-10-09',id:"x),user_id.neq.any"}])('rejects cursor injection before querying',async cursor=>{
  const s=fixture([]);await expect(s.repo.getMovements(cursor)).rejects.toMatchObject({code:'mapping'});expect(s.sdk.from).not.toHaveBeenCalled();
 });
 it('requires a verified authenticated owner',async()=>{
  const s=fixture([]);s.sdk.auth.getUser.mockResolvedValueOnce({data:{user:{id:'foreign'}},error:null});
  await expect(s.repo.getMovements(null)).rejects.toMatchObject({code:'session'});expect(s.sdk.from).not.toHaveBeenCalled();
 });
 it.each([
  {...row(1),amount:'0.001'}, {...row(1),amount:'NaN'}, {...row(1),transaction_date:'infinity'},
  {...row(1),from_account:{name:'Revolut',currency:'USD'}}, {...row(1),from_account:null},
 ])('fails safely on incompatible historical values %s',async value=>{
  await expect(fixture([value]).repo.getMovements(null)).rejects.toThrow();
 });
});
