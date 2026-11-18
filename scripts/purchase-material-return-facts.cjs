const text=v=>typeof v==='string'?v.trim():''
const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null
function normalizeMaterialReturn(directory,detail){
 if(!text(directory.id)||directory.org_id!=='100000'||directory.billno!==detail.billno)throw Error('return_identity_mismatch')
 if(!['标准采购退料单','采购退料单','采购退料'].includes(detail.billtype_name))return null
 if(!Array.isArray(detail.billentry)||!Array.isArray(directory.billentry))throw Error('missing_entries')
 if(detail.billentry.length!==directory.billentry.length)throw Error('entry_count_changed')
 if(text(directory.lastupdatetime)&&text(detail.lastupdatetime)&&directory.lastupdatetime!==detail.lastupdatetime)throw Error('source_version_changed')
 const seen=new Set()
 const lines=detail.billentry.map(line=>{
  const originals=directory.billentry.filter(l=>l.seq===line.seq)
  if(originals.length!==1||!text(originals[0].id)||seen.has(originals[0].id))throw Error('ambiguous_entry_identity')
  const origin=originals[0];seen.add(origin.id)
  if(origin.hzkj_salbillnumber!==line.hzkj_salbillnumber||num(origin.qty)!==num(line.qty))throw Error('source_changed_during_capture')
  return {id:origin.id,orderNumber:text(line.hzkj_salbillnumber)||null,sku:text(line.hzkj_local_sku_number)||text(line.material_number),name:text(line.hzkj_local_sku_name),variant:text(line.hzkj_local_sku_hzkj_sku_value),imageUrl:text(line.hzkj_local_sku_hzkj_picturefield)||null,
   quantity:num(line.qty)===null?null:Math.abs(line.qty),rawQuantity:num(line.qty),returnedQuantity:null,nativeReturnQuantity:num(line.returnqty),nativeRemainingReturnQuantity:num(line.remainreturnqty),returnMaterialType:text(line.returnmaterialtype),
   sourceDocumentNumber:text(line.srcbillnumber)||null,sourceEntryId:text(origin.srcbillentryid)||null,sourceDocumentId:text(origin.srcbillid)||null,warehouse:text(line.warehouse_name)||null,reason:text(line.entrycomment)||null,
   association:{level:'order-number',fulfillmentLineId:null,source:'billentry.hzkj_salbillnumber'}}
 })
 const sum=values=>values.every(v=>v!==null)?values.reduce((a,b)=>a+b,0):null
 return {id:directory.id,number:detail.billno,status:'unknown',billStatus:detail.billstatus,billStatusName:text(detail.billstatus_title)||null,
  sourceEntity:'im_purinbill',sourceVersion:text(detail.lastupdatetime)||text(directory.modifytime)||null,
  purchaseOrder:{id:'',number:''},supplier:{id:'',name:text(detail.supplier_name)},warehouseCode:'',warehouse:lines[0]?.warehouse??'',
  createdAt:text(detail.createtime)?detail.createtime.replace(' ','T')+'+08:00':null,logistics:{carrier:null,trackingNumber:null},lines,
  quantity:sum(lines.map(l=>l.quantity)),returnedQuantity:null,missingFields:['return_execution_status','returned_quantity_semantics','return_logistics','purchase_order_relation','fulfillment_line_id']}
}
module.exports={normalizeMaterialReturn}
