type Row=Record<string,any>
export type InventoryRead=(kind:'reserved'|'current',body:unknown)=>Promise<any>
const qty=(v:unknown):number|null=>v===null||v===undefined?null:typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=Number.MAX_SAFE_INTEGER?v:(()=>{throw Error('Invalid inventory quantity')})()
export function reservedInventoryRow(r:Row){
 for(const key of ['id','org_id','hzkj_customer_id','hzkj_local_sku_id','hzkj_local_sku_number','hzkj_warehouse_number'])if(typeof r[key]!=='string'||!r[key])throw Error('Invalid inventory identity')
 const balance=(available:string,locked:string)=>({available:qty(r[available]),locked:qty(r[locked]),onHand:null})
 return {id:r.id,customerId:r.hzkj_customer_id,customerCode:r.hzkj_customer_number??'',customerName:r.hzkj_customer_name??'',skuId:r.hzkj_local_sku_id,sku:r.hzkj_local_sku_number,name:r.hzkj_local_sku_name??'',imageUrl:typeof r.hzkj_local_sku_hzkj_picturefield==='string'&&/^https:\/\//.test(r.hzkj_local_sku_hzkj_picturefield)?r.hzkj_local_sku_hzkj_picturefield:null,warehouseCode:r.hzkj_warehouse_number,warehouse:r.hzkj_warehouse_name??'',fullPayment:balance('hzkj_total_available_qty','hzkj_lock_qty'),deposit:balance('hzkj_deposit_avail_qty','hzkj_deposit_lock_qty'),onHand:null,owner:null,department:null}
}
export async function inventoryPages(read:InventoryRead,kind:'reserved'|'current',companyId:string,orgNumber:string,filters:Row={}){
 const rows:Row[]=[],ids=new Set<string>();let total:number|undefined
 for(let pageNo=1;pageNo<=20;pageNo++){
  const d=await read(kind,{data:{org_number:orgNumber,...filters},pageNo,pageSize:100})
  if(!d||d.pageNo!==pageNo||d.pageSize!==100||!Array.isArray(d.rows)||d.rows.length>100||!Number.isSafeInteger(d.totalCount)||d.totalCount<0||typeof d.lastPage!=='boolean'||(total!==undefined&&total!==d.totalCount))throw Error('Invalid inventory page')
  total=d.totalCount
  for(const r of d.rows){
   if(typeof r.id!=='string'||ids.has(r.id)||r.org_id!==companyId||r.org_number!==orgNumber)throw Error('Invalid inventory scope')
   ids.add(r.id);rows.push(r)
  }
  if(d.lastPage){if(rows.length!==total)throw Error('Incomplete inventory page');return rows}
  if(!d.rows.length)throw Error('Empty intermediate inventory page')
 }
 throw Error('Inventory result too large; narrow customer or SKU')
}
export function currentInventoryRow(r:Row){
 return {id:r.id,sku:r.material_number??'',name:r.material_name??'',warehouseCode:r.warehouse_number,warehouse:r.warehouse_name??'',customer:null,pool:'unknown',onHand:qty(r.qty),occupied:null,free:null}
}

/** SKU ID and inventory material ID are different FOP entities. */
export function inventoryMaterial(line:Row):{id:string;sku:string;name:string}{
 const sku=line.hzkj_local_sku
 const ids=[sku?.hzkj_material?.id,line.hzkj_material?.id,line.hzkj_material_id].filter(v=>v!==undefined&&v!==null&&v!=='')
 if(new Set(ids).size>1)throw Error('Conflicting inventory material mapping')
 const id=ids[0],number=sku?.number??line.hzkj_local_sku_number
 if(typeof id!=='string'||!id||typeof number!=='string'||!number)throw Error('Inventory material mapping unavailable')
 return {id,sku:number,name:sku?.name?.zh_CN??sku?.name??line.hzkj_local_sku_name??''}
}
