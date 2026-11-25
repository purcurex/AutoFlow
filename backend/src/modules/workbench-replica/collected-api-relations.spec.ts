import {normalizeApiRelations} from './collected-api-relations'
const root={id:'1',number:'TO1',kind:'fulfillment'},at='2026-11-25T00:00:00Z'
const bill=(entity:string,billId:string,billNo:string)=>({entity,billId,billNo,billStatus:'C'})
const link=(sourceEntity:string,sourceBillId:string,targetEntity:string,targetBillId:string)=>({sourceEntity,sourceBillId,targetEntity,targetBillId,basis:'BOTP'})
const fixture=()=>({orderId:'1',orderNo:'TO1',level:'BILL',complete:true,bills:[bill('hzkj_orders','1','TO1'),bill('hzkj_orders','2','TO2'),bill('hzkj_purapplybill','3','PA3'),bill('hzkj_purorderbill','4','PO4')],links:[link('hzkj_orders','1','hzkj_purapplybill','3'),link('hzkj_purapplybill','3','hzkj_purorderbill','4'),link('hzkj_orders','2','hzkj_purorderbill','4')]})
it('uses actual application-to-purchase edge while excluding sibling orders',()=>{const g=normalizeApiRelations(fixture(),root,at);expect(g.documents.map(d=>d.number)).toEqual(['TO1','PA3','PO4']);expect(g.relations).toHaveLength(2);expect(g.quantityComplete).toBe(false)})
it('rejects mismatched roots and dangling edges',()=>{expect(()=>normalizeApiRelations(fixture(),{...root,id:'2'},at)).toThrow();const f=fixture();f.bills.pop();expect(()=>normalizeApiRelations(f,root,at)).toThrow()})
it('keeps the source incompleteness without treating bill edges as quantity allocation',()=>{const f={...fixture(),complete:false,issues:[{code:'USAGE_RECORD_INVALID'}]};expect(normalizeApiRelations(f,root,at)).toMatchObject({complete:false,quantityComplete:false,issues:f.issues})})

it('accepts standard inventory documents in the business chain',()=>{const f=fixture();f.bills.push(bill('im_purinbill','5','IN5'));f.links.push(link('hzkj_purorderbill','4','im_purinbill','5'));expect(normalizeApiRelations(f,root,at).documents).toHaveLength(4)})
it('rejects a node identity that contradicts the requested root number',()=>{const f=fixture();f.bills[0].billNo='TO99';expect(()=>normalizeApiRelations(f,root,at)).toThrow('relation_root_number_mismatch')})
import {readApiRelations} from './collected-api-relations'
it('does not serve complete but invalidated API snapshots',async()=>{
 const raw=fixture(),now=new Date().toISOString();const db={query:jest.fn().mockResolvedValueOnce([{raw,captured_at:now}]).mockResolvedValueOnce([{requested_version:'2',published_version:'1',checked_at:now}])}
 expect(await readApiRelations(db,'b',{source_id:'1',number:'TO1',kind:'fulfillment'})).toBeNull()
})
