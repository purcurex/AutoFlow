const {test}=require('node:test'),assert=require('node:assert/strict'),{linkReturnPurchases}=require('./material-return-purchase-links.cjs')
test('keeps multiple purchases per order, restricts company and never matches SKU',()=>{
 const document={lines:[{orderNumber:'O1',sku:'S'},{orderNumber:'O2',sku:'S'},{orderNumber:null,sku:'S'}]}
 const purchase=(id,org,lines)=>({id,billno:id,organizationId:org,hzkj_billentry:lines})
 const line=(id,order)=>({id,hzkj_salbillnumber:order,sku:'S'})
 const result=linkReturnPurchases(document,[purchase('P1','100000',[line('L1','O1'),line('L2','O2')]),purchase('P2','100000',[line('L3','O1')]),purchase('P3','other',[line('L4','O1')])],'100000')
 assert.deepEqual(result.lines[0].orderPurchases.map(p=>p.id),['P1','P2']);assert.deepEqual(result.lines[1].orderPurchases[0].lineIds,['L2']);assert.deepEqual(result.lines[2].orderPurchases,[])
 assert.equal(result.purchaseOrder,undefined)
})
