const test=require('node:test'),assert=require('node:assert/strict');
const {exceptionNeedsRecheck}=require('./workbench-physical-business-rebuild.cjs');
const base=()=>({is_exception:false,display:{items:[{id:'p',purchaseState:'unknown'}],businessStatus:{outbound:'pending'},fulfillmentProgress:{outbound:'unknown'},exception:null}});
test('does not recheck unchanged source and business facts for display-only alignment',()=>{
 const before=base(),after={...before.display,items:[{id:'p',purchaseState:'unpurchased',isVirtual:false}],fulfillmentProgress:{outbound:'pending'}};
 assert.equal(exceptionNeedsRecheck(before,after),false);
});
for(const kind of ['existing_exception','virtual_before','virtual_after','business_changed','exception_changed','unexpected_change'])test('preserves exception evaluation for '+kind,()=>{
 const before=base(),after=structuredClone(before.display);
 if(kind==='existing_exception')before.is_exception=true;
 if(kind==='virtual_before')before.display.items[0].isVirtual=true;
 if(kind==='virtual_after')after.items[0].isVirtual=true;
 if(kind==='business_changed')after.businessStatus.outbound='partial';
 if(kind==='exception_changed')after.exception={type:'allocation_exception'};
 if(kind==='unexpected_change')after.futureRuleField='changed';
 assert.equal(exceptionNeedsRecheck(before,after),true);
});
