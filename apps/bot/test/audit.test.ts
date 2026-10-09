// B1/B4/B5 regression expectations assert safe behavior; the separate B6 finding remains characterized.
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseMessage, parseAmountInput } from "@finance-tracker/domain";
import { ProposalFlow } from "../src/proposal-flow.js";
import { deliverUpdate } from "../src/flow-delivery.js";
import { SupabaseTransactionRepository } from "../src/supabase.js";
const chat = 123456;
const config = { allowedChatId: String(chat) };
const message = (text: string, id = 1) => ({ update_id: id, message: { message_id: id, text, chat: { id: chat, type: "private" } } });
const confirm = (flow: ProposalFlow) => {
  const p = flow.store.get(chat)!;
  return {update_id:99,callback_query:{id:"synthetic",from:{id:chat},data:`p:${p.id}:${p.revision}:confirm`,message:{message_id:9,chat:{id:chat,type:"private"}}}};
};
const flows: ProposalFlow[] = [];
afterEach(() => { flows.splice(0).forEach(f => f.store.clear()); vi.restoreAllMocks(); });
function fixture(loseFirstResponse = false) {
  const flow = new ProposalFlow(); flows.push(flow);
  const ledger: unknown[] = [];
  const receipts = new Map<string, {payload:string;id:string}>();
  const user = {id:"00000000-0000-4000-8000-000000000001"};
  const accounts = ["Revolut","Contanti"].map((name,i) => ({id:`10000000-0000-4000-8000-00000000000${i+1}`,user_id:user.id,name,is_active:true}));
  const query = {select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),then:(resolve:(r:unknown)=>void)=>resolve({data:accounts,error:null})};
  let payload: unknown;
  const insert = {insert:vi.fn((p:unknown)=>{payload=p;return insert;}),select:vi.fn().mockReturnThis(),single:vi.fn(async()=>{
    ledger.push(payload); // Simulate the server committing BEFORE the client loses the response.
    if (loseFirstResponse && ledger.length === 1) throw new Error("Synthetic response lost after commit");
    return {data:{id:`synthetic-${ledger.length}`},error:null};
  })};
  const sdk = {auth:{getSession:vi.fn().mockResolvedValue({data:{session:{user,access_token:"synthetic",expires_at:Date.now()/1000+3600}},error:null}),
    getUser:vi.fn().mockResolvedValue({data:{user},error:null})},from:vi.fn((table:string)=>table==="accounts"?query:insert),rpc:vi.fn(async(name:string,args:Record<string,string>)=>{
    const receipt=receipts.get(args.p_request_id);
    if(name==="get_transaction_receipt") return {data:receipt ? [{transaction_id:receipt.id}] : [],error:null};
    const canonical=JSON.stringify(args);
    if(receipt) return receipt.payload===canonical ? {data:[{transaction_id:receipt.id}],error:null} : {data:null,error:{code:"PT409"}};
    const id=`synthetic-${ledger.length+1}`;ledger.push(args);receipts.set(args.p_request_id,{payload:canonical,id});
    if(loseFirstResponse && ledger.length===1) throw new Error("Synthetic timeout after commit");
    return {data:[{transaction_id:id}],error:null};
  })};
  const repo = new SupabaseTransactionRepository(()=>({url:"https://synthetic.invalid",anonKey:"synthetic",email:"test@example.invalid",password:"synthetic"}),(()=>sdk) as never);
  const transport = {call:vi.fn().mockResolvedValue(true),sendMessage:vi.fn().mockResolvedValue(undefined)};
  const deliver = (update:unknown) => deliverUpdate(flow,transport,update,config,undefined,repo);
  return {flow,ledger,deliver,repo,transport};
}
describe("Audit — B1 regression", () => {
  it.each(["12 tabacco revolut","12 stipendio revolut","12 da revolut a contanti"])("commit plus lost response preserves one %s on retry",async text=>{
    vi.spyOn(console,"error").mockImplementation(()=>{});
    const s=fixture(true);await s.deliver(message(text));const callback=confirm(s.flow);
    await s.deliver(callback);expect(s.ledger).toHaveLength(1);expect(s.flow.store.get(chat)).toBeDefined();
    await s.deliver(callback);expect(s.ledger).toHaveLength(1);expect(s.flow.store.get(chat)).toBeUndefined();
  });
  it("the same Telegram update cannot create a second saved movement",async()=>{
    const s=fixture();const update=message("12 tabacco revolut");
    await s.deliver(update);await s.deliver(confirm(s.flow));
    await s.deliver(update);await s.deliver(confirm(s.flow));expect(s.ledger).toHaveLength(1);
  });
  it("editing a saved source cannot create another movement",async()=>{
    const s=fixture();await s.deliver(message("12 tabacco revolut"));await s.deliver(confirm(s.flow));
    await s.deliver({update_id:2,edited_message:message("13 tabacco revolut").message});await s.deliver(confirm(s.flow));
    expect(s.ledger).toHaveLength(1);expect(s.ledger[0]).toMatchObject({p_amount:"12.00"});
  });
  it("editing the active source to /help leaves its old amount confirmable",async()=>{
    const s=fixture();await s.deliver(message("12 tabacco revolut"));
    await s.deliver({update_id:2,edited_message:message("/help").message});
    expect(s.flow.store.get(chat)?.amount).toBe(12);await s.deliver(confirm(s.flow));expect(s.ledger).toHaveLength(1);
  });
  it("restarting and replaying the original source preserves the operation key",async()=>{
    const s=fixture(true);vi.spyOn(console,"error").mockImplementation(()=>{});
    await s.deliver(message("12 tabacco revolut"));const old=confirm(s.flow);await s.deliver(old);
    s.flow.store.clear();const restarted=new ProposalFlow();flows.push(restarted);
    await deliverUpdate(restarted,s.transport,old,config,undefined,s.repo);expect(s.ledger).toHaveLength(1);
    await deliverUpdate(restarted,s.transport,message("12 tabacco revolut"),config,undefined,s.repo);
    await deliverUpdate(restarted,s.transport,confirm(restarted),config,undefined,s.repo);expect(s.ledger).toHaveLength(1);
  });
});
describe("Audit — B4/B5 regressions",()=>{
  it.each(["-€12 spesa","−€12 spesa","- EUR 12 spesa","–12 spesa"])("free text rejects the signed amount in %s",text=>{
    expect(parseMessage(text).amount).toBeNull();expect(parseAmountInput(text)).toBeNull();
  });
  it.each(["12 da revolut a contanti isybank","12 da contanti a revolut e isybank"])("requests clarification for a third account in %s",text=>{
    const result=parseMessage(text);expect(result.type).toBe("transfer");
    expect(result.fromAccount).toBeNull();expect(result.toAccount).toBeNull();
  });
});
describe("Audit — adversarial parser invariants",()=>{
  it("rejects 200 sub-cent amounts and 200 signed amounts",()=>{
    for(let i=1;i<=200;i++) {
      expect(parseMessage(`${i},123 tabacco`).amount).toBeNull();
      expect(parseMessage(`-${i} tabacco`).amount).toBeNull();
    }
  });
  it("round-trips 1000 exact cent amounts",()=>{
    for(let cents=1;cents<=1000;cents++) {
      const text=`${Math.floor(cents/100)},${String(cents%100).padStart(2,"0")} spesa contanti`;
      expect(parseMessage(text).amount).toBe(cents/100);
    }
  });
  it("rejects impossible dates, conflicting dates and equal transfer aliases",()=>{
    for(const date of ["29/02/2025","31/04/2026","0000-01-01","10000-01-01","oggi ieri"])
      expect(parseMessage(`12 tabacco ${date}`).date).toBeNull();
    const p=parseMessage("12 da contanti a cash");expect(p.fromAccount).toBe(p.toAccount);
  });
});

describe("B4/B5 — six manual Telegram regressions", () => {
  it.each([
    ["-€12 spesa revolut", "importo valido"],
    ["−€12 spesa revolut", "importo valido"],
    ["- EUR 12 spesa revolut", "importo valido"],
    ["–12 spesa revolut", "importo valido"],
    ["12 da contanti a revolut e isybank", "conti mancanti o ambigui"],
    ["20 da revolut a isybank o contanti", "conti mancanti o ambigui"],
  ])("rejects %s before proposal and persistence", async (text, clarification) => {
    const s = fixture();
    await s.deliver(message(text));
    expect(s.flow.store.getState(chat)).toBeUndefined();
    expect(s.ledger).toHaveLength(0);
    expect(s.transport.sendMessage).toHaveBeenCalledWith(chat, expect.stringContaining(clarification), undefined, undefined);
    expect(s.transport.sendMessage.mock.calls.some(call => call[3]?.inline_keyboard?.flat().some((button: { text: string }) => button.text.includes("Conferma")))).toBe(false);
  });
});
