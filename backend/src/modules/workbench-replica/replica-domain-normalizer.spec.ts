import { normalizeReplicaGroup, sourceEntityIdentity } from './replica-domain-normalizer'
import { completeFulfillmentDomainFixture } from './replica-domain.fixture'
const scope = {connectionId:'00000000-0000-4000-a000-000000000001',companyId:'00000000-0000-4000-a000-000000000002',datasetId:'00000000-0000-4000-a000-000000000003'}
const doc = (): any => ({eventId:'evt-1',entityCode:'hzkj_orders',sourceId:'90071992547409931',sourceVersion:'999999999999999999999',operation:'upsert',documentNumber:'TO-1',linesComplete:true,relationsComplete:true,sourceFields:{rawBillStatus:'C'},header:{rawPurchaseStatus:'0',rawDeliveryStatus:'0',totalAmount:'1.00000001',customerPaidAt:'2026-11-11T01:00:00+08:00'},packages:[],entries:[{entryEntity:'entry',sourceEntryId:'90071992547409933',skuCode:'SKU',quantity:'1.00000001'}],relations:[],workbench:{ownerEmployeeIds:['large-id'],ownershipVerifiedAt:'2026-11-11T01:00:00+08:00',ownershipVersion:'v1',customerName:'Customer',customerPaymentState:'paid',cancelled:false}})
const group = (document=doc()): any => ({schemaVersion:'fop-replica-domain/1',groupKey:'group-1',afterCursor:null,endCursor:'opaque-1',committedAt:'2026-11-11T01:00:00+08:00',expectedCount:1,documents:[document]})
it('normalizes domain facts with scope-isolated deterministic ids and exact decimal/source identity strings',()=>{
 const a=normalizeReplicaGroup(scope,group()),b=normalizeReplicaGroup(scope,group())
 expect(a).toEqual(b);expect(a.events[0].sourceId).toBe('90071992547409931');expect(a.events[0].sourceVersion).toBe('999999999999999999999')
 expect(a.events[0].localDocumentId).toBe(sourceEntityIdentity(scope,'hzkj_orders','90071992547409931'))
 expect(normalizeReplicaGroup({...scope,datasetId:'00000000-0000-4000-a000-000000000004'},group()).events[0].localDocumentId).not.toBe(a.events[0].localDocumentId)
 expect(a.events[0].rows.find(r=>r.table==='hz_fop_source_lines')?.values.quantity).toBe('1.00000001')
 const projection=a.projections[0].rows.find(r=>r.table==='hz_fop_workbench_orders')!.values
 expect(projection.customer_paid_at).toBe('2026-11-11T01:00:00+08:00');expect(projection.consumer_paid_at).toBe(projection.customer_paid_at)
 expect(projection.order_review_state).toBe('approved');expect(projection.supplier_payment_state).toBe('unknown');expect(projection.readiness).toBe('incomplete')
})
it('rejects SQL/table injection, numeric IDs/versions, incomplete entries and unsupported entities',()=>{
 for(const edit of [(d:any)=>d.rows=[],(d:any)=>d.sourceId=9007199254740991,(d:any)=>d.sourceVersion=1,(d:any)=>d.linesComplete=false,(d:any)=>d.relationsComplete=false,(d:any)=>d.header.table='users',(d:any)=>d.entityCode='unknown_entity']){const d=doc();edit(d);expect(()=>normalizeReplicaGroup(scope,group(d))).toThrow()}
})
it('publishes receipt notice independently with exact complete inbound quantities and source ownership',()=>{
 const d=doc();d.entityCode='hzkj_receiptnotice';delete d.packages;d.header={warehouseId:'warehouse',supplierId:'supplier',rawWmsStatus:'10',supplierShippedAt:'2026-11-11T01:00:00Z',trackingNumber:'SF1'};d.entries[0].inboundQuantity='0.00000001';d.workbench={ownerEmployeeIds:['owner'],ownershipVerifiedAt:'2026-11-11T01:00:00Z',ownershipVersion:'v1',shipmentState:'shipped',carrierName:'顺丰'}
 const result=normalizeReplicaGroup(scope,group(d));expect(result.projections).toHaveLength(0);const p=result.receiptNotices![0]
 expect(p.rows[0].values).toMatchObject({quantity:'1.00000001',inbound_quantity:'0.00000001',carrier_name:'顺丰',owner_employee_ids:['owner']})
 delete d.entries[0].inboundQuantity;expect(()=>normalizeReplicaGroup(scope,group(d))).toThrow('inboundQuantity')
})
it('derives relation endpoints and tombstone publications without accepting local IDs',()=>{
 const d=doc();d.operation='delete';delete d.header;delete d.workbench;d.entries=[]
 const out=normalizeReplicaGroup(scope,group(d));expect(out.events[0].rows).toEqual([]);expect(out.projections[0]).toMatchObject({deleted:true,rows:[]})
 const relation=doc();relation.relations=[{sourceRelationId:'r-1',relationType:'dispatch',from:{entityCode:'hzkj_orders',sourceId:relation.sourceId},to:{entityCode:'hzkj_deliver_bill',sourceId:'dispatch-1'}}]
 const r=normalizeReplicaGroup(scope,group(relation)).events[0].rows.find(r=>r.table==='hz_fop_document_relations')!
 expect(r.values.from_document_id).toBe(sourceEntityIdentity(scope,relation.entityCode,relation.sourceId));expect(r.values.removed_at).toBeNull();expect(r.values.holder_document_id).toBe(r.values.from_document_id)
})
it('requires complete entity-specific collections and does not infer unknown bill statuses',()=>{
 const d=doc();d.sourceFields.rawBillStatus='mystery';const out=normalizeReplicaGroup(scope,group(d));expect(out.projections[0].rows[0].values.order_review_state).toBe('unknown')
 for(const [entity,collection]of [['hzkj_orders','packages'],['hzkj_deliver_bill','trackingNumbers'],['hzkj_purorderbill','platformOrders']]){const d=doc();d.entityCode=entity;d.header={};delete d.packages;delete d[collection];expect(()=>normalizeReplicaGroup(scope,group(d))).toThrow('complete')}
})
it('adds relation-derived affected orders to require their same-group publication',()=>{
 const d=doc();d.entityCode='hzkj_deliver_bill';delete d.packages;d.header={};d.trackingNumbers=[];d.relations=[{sourceRelationId:'r',relationType:'dispatch',from:{entityCode:'hzkj_orders',sourceId:'order-2'},to:{entityCode:'hzkj_deliver_bill',sourceId:d.sourceId}}]
 expect(()=>normalizeReplicaGroup(scope,group(d))).toThrow('Missing affected order projection')
})
it('publishes explicit procurement demand and allocation facts with stable source line references',()=>{
 const d=doc();const orderLine={entityCode:d.entityCode,sourceId:d.sourceId,entryEntity:'entry',sourceEntryId:d.entries[0].sourceEntryId}
 d.workbench.procurementDemands=[{line:orderLine,effectiveOrderQuantity:'1',stockCoveredQuantity:'0',requiredQuantity:'1',allocatedQuantity:'1',unassignedQuantity:'0',unitCode:'piece'}]
 d.workbench.purchaseAllocations=[{sourceAllocationId:'allocation-1',line:orderLine,purchaseLine:{entityCode:'hzkj_purorderbill',sourceId:'purchase-1',entryEntity:'entry',sourceEntryId:'purchase-line-1'},allocatedRequirementQuantity:'1',purchasedQuantity:'1',supplierShippedQuantity:'0',inboundQuantity:'0',cancelledQuantity:'0',returnedQuantity:'0',remainingSupplyQuantity:'1'}]
 const out=normalizeReplicaGroup(scope,group(d));expect(out.projections[0].rows.find(r=>r.table==='hz_fop_workbench_procurement_demands')?.values).toMatchObject({calculation_state:'known',required_quantity:'1'})
 expect(out.projections[0].rows.find(r=>r.table==='hz_fop_workbench_purchase_allocations')?.values).toMatchObject({allocation_state:'known',purchase_document_id:sourceEntityIdentity(scope,'hzkj_purorderbill','purchase-1'),supplier_shipped_quantity:'0'})
})
it('provides an explicit complete synthetic unpaid fixture that is ready and has correct queue membership',()=>{
 const out=normalizeReplicaGroup(scope,completeFulfillmentDomainFixture());expect(out.projections[0].rows[0].values).toMatchObject({readiness:'ready',total_amount:'10',currency_code:'USD'})
 expect(out.projections[0].rows.find(r=>r.table==='hz_fop_workbench_memberships'&&r.values.queue_code==='unpaid')?.values.classification_state).toBe('member')
})
it('classifies complete current related documents locally instead of leaving RMA permanently unknown',()=>{
 const g=completeFulfillmentDomainFixture() as any
 g.documents[0].workbench.relatedDocuments=[]
 let out=normalizeReplicaGroup(scope,g);expect(out.projections[0].rows.find(r=>r.table==='hz_fop_workbench_memberships'&&r.values.queue_code==='rma')?.values.classification_state).toBe('non_member')
 g.documents[0].workbench.relatedDocuments=[{entityCode:'hzkj_after_sale_orders',sourceId:'rma-1',sourceVersion:'2',relationRevision:'0'}]
 out=normalizeReplicaGroup(scope,g);expect(out.projections[0].rows.find(r=>r.table==='hz_fop_workbench_memberships'&&r.values.queue_code==='rma')?.values.classification_state).toBe('member')
 expect(out.projections[0].rows.some(r=>r.table==='hz_fop_projection_dependencies'&&r.values.source_document_id===sourceEntityIdentity(scope,'hzkj_after_sale_orders','rma-1'))).toBe(true)
})
it('allows stock projections with explicit applicable facts and keeps inapplicable outbound unknown',()=>{
 const g=completeFulfillmentDomainFixture() as any,d=g.documents[0]
 d.entityCode='hzkj_stock_order_new';d.header={customerId:'customer',ownerEmployeeId:'owner',warehouseId:'warehouse',stockType:'full_payment',totalAmount:'10',settlementCurrency:'USD',businessCreatedAt:'2026-11-11T01:00:00Z',rawPurchaseStatus:'0'};d.workbench={ownerEmployeeIds:['owner'],ownershipVersion:'v1',ownershipVerifiedAt:'2026-11-11T01:00:00Z',cancelled:false,customerPaymentState:'unpaid',purchaseCoverageState:'not_ordered',platformOrderState:'not_pushed',supplierPaymentState:'unpaid',supplierShipmentState:'pending'}
 const out=normalizeReplicaGroup(scope,g);expect(out.projections[0].rows[0].values).toMatchObject({readiness:'ready',outbound_state:'unknown',stock_type:'full_payment'})
})
