import {afterEach,describe,expect,it,vi} from "vitest";
import {sourceOperationKey,compactOperationKey,expandOperationKey} from "../src/operation-key.js";
import {ProposalFlow} from "../src/proposal-flow.js";
import {ProposalStore} from "../src/proposals.js";
import {proposalKeyboard} from "../src/proposal-view.js";
import {deliverUpdate} from "../src/flow-delivery.js";
const chat=123456, config={allowedChatId:String(chat)}, now=new Date("2026-10-09T12:00:00Z");
const flows:ProposalFlow[]=[];
const text=(value:string,id=1)=>({update_id:id,message:{message_id:id,text:value,chat:{id:chat,type:"private"}}});
const callback=(flow:ProposalFlow,action:string)=>{
 const state=flow.store.getState(chat)!;
 const data=state.kind==="proposal"
  ? action==="confirm" ? proposalKeyboard(state.proposal).inline_keyboard[0][0].callback_data : `p:${state.proposal.id}:${state.proposal.revision}:${action}`
  : state.kind==="menu" ? `m:${state.id}:${action}` : `w:${state.id}:${"revision" in state?state.revision:0}:${action}`;
 return {update_id:999,callback_query:{id:"synthetic",from:{id:chat},data,message:{message_id:99,chat:{id:chat,type:"private"}}}};
};
afterEach(()=>{flows.splice(0).forEach(f=>f.store.clear());vi.restoreAllMocks();});
describe("B1 operation identities",()=>{
 it("is stable across stores/replay, independent of payload, distinct for different source/chat",()=>{
   const a=new ProposalStore(),b=new ProposalStore();
   try {
    const p=a.create(chat,1,{type:"expense",amount:12,date:"2026-10-09",category:"tobacco",account:"revolut"});
    const replay=b.create(chat,1,{type:"expense",amount:13,date:"2026-10-10",category:"food",account:"contanti"});
    expect(replay.requestId).toBe(p.requestId);expect(replay.id).not.toBe(p.id);
    expect(sourceOperationKey(chat,2)).not.toBe(p.requestId);expect(sourceOperationKey(chat+1,1)).not.toBe(p.requestId);
    const changed=a.replaceValues(chat,{type:"income",amount:12,date:"2026-10-09",category:"salary",account:"revolut"});
    expect(changed.requestId).toBe(p.requestId);
   }finally{a.clear();b.clear();}
 });
 it("round-trips keys and keeps Telegram callback data below 64 bytes",()=>{
   const store=new ProposalStore();
   try {
    for(let i=1;i<=1000;i++) {
      const key=sourceOperationKey(chat,i);expect(expandOperationKey(compactOperationKey(key))).toBe(key);
    }
    for(const value of ["", "!".repeat(22),"a".repeat(21),"a".repeat(23)]) expect(expandOperationKey(value)).toBeNull();
    const p=store.create(chat,1,{type:"expense",amount:1,date:"2026-10-09",category:"food",account:"revolut"});p.revision=99999999;
    expect(Buffer.byteLength(proposalKeyboard(p).inline_keyboard[0][0].callback_data)).toBeLessThanOrEqual(64);
   }finally{store.clear();}
 });
 it("guided completion uses the source /menu identity after a process-state reset",()=>{
   const complete=(id:number)=>{
    const flow=new ProposalFlow();flows.push(flow);
    flow.handle(text("/menu",id),config,now);
    flow.handle(callback(flow,"movement"),config,now);
    flow.handle(callback(flow,"type.expense"),config,now);
    flow.handle(text("12",id+100),config,now);
    flow.handle(callback(flow,"category.tobacco"),config,now);
    flow.handle(callback(flow,"account.revolut"),config,now);
    flow.handle(callback(flow,"date.today"),config,now);
    return flow.store.get(chat)!;
   };
   expect(complete(1).requestId).toBe(sourceOperationKey(chat,1));
   expect(complete(1).requestId).toBe(complete(1).requestId);
   expect(complete(2).requestId).not.toBe(complete(1).requestId);
 });
 it("after restart a confirmation can only retrieve a receipt, never reconstruct a write",async()=>{
   const original=new ProposalFlow(),restarted=new ProposalFlow();flows.push(original,restarted);
   original.handle(text("12 tabacco"),config,now);const confirm=callback(original,"confirm");
   const client={call:vi.fn().mockResolvedValue(true),sendMessage:vi.fn().mockResolvedValue(undefined)};
   const repo={getTransactionReceipt:vi.fn().mockResolvedValue({id:"synthetic"}),saveTransaction:vi.fn()};
   await deliverUpdate(restarted,client,confirm,config,undefined,repo);
   expect(repo.getTransactionReceipt).toHaveBeenCalledWith(sourceOperationKey(chat,1));expect(repo.saveTransaction).not.toHaveBeenCalled();
   expect(client.sendMessage.mock.calls.at(-1)?.[1]).toContain("Ricevuta recuperata");
   repo.getTransactionReceipt.mockResolvedValueOnce(null as never);
   await deliverUpdate(restarted,client,confirm,config,undefined,repo);expect(repo.saveTransaction).not.toHaveBeenCalled();
 });
 it("uncertain writes keep key and values frozen; stale recovery does not remove a new proposal",async()=>{
   vi.spyOn(console,"error").mockImplementation(()=>{});
   const flow=new ProposalFlow();flows.push(flow);
   const client={call:vi.fn().mockResolvedValue(true),sendMessage:vi.fn().mockResolvedValue(undefined)};
   const repo={getTransactionReceipt:vi.fn().mockResolvedValue({id:"saved"}),saveTransaction:vi.fn().mockRejectedValue(new Error("synthetic timeout"))};
   await deliverUpdate(flow,client,text("12 tabacco"),config,undefined,repo);const p=flow.store.get(chat)!;const old=callback(flow,"confirm");
   await deliverUpdate(flow,client,old,config,undefined,repo);expect(p.submitted).toBe(true);
   await deliverUpdate(flow,client,callback(flow,"field.amount"),config,undefined,repo);
   await deliverUpdate(flow,client,{update_id:2,edited_message:text("13 tabacco").message},config,undefined,repo);
   expect(flow.store.get(chat)?.amount).toBe(12);expect(flow.store.get(chat)?.requestId).toBe(p.requestId);
   await deliverUpdate(flow,client,text("14 tabacco",3),config,undefined,repo);const fresh=flow.store.get(chat)!;
   await deliverUpdate(flow,client,old,config,undefined,repo);expect(flow.store.get(chat)).toBe(fresh);expect(repo.saveTransaction).toHaveBeenCalledTimes(1);
 });
 it("unauthorized callbacks cannot recover receipts",()=>{
   const flow=new ProposalFlow();flows.push(flow);flow.handle(text("12 tabacco"),config,now);
   const update=callback(flow,"confirm");update.callback_query.from.id=654321;flow.store.clear();
   expect(flow.handle(update,config,now)).toEqual([]);
 });
});
