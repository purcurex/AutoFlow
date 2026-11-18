// Relations are order-level only: a shared SKU never proves the source purchase of a return.
function linkReturnPurchases(document, purchases, companyId) {
 const index=new Map()
 for(const p of purchases){
  if(String(p.organizationId)!==companyId||!p.id||!p.billno)continue
  for(const line of p.hzkj_billentry??[]){
   const number=String(line.hzkj_salbillnumber??'').trim()
   if(!number||!line.id)continue
   if(!index.has(number))index.set(number,new Map())
   const refs=index.get(number),ref=refs.get(p.id)??{id:p.id,number:p.billno,lineIds:[],associationLevel:'order-number',source:'hzkj_billentry.hzkj_salbillnumber'}
   if(!ref.lineIds.includes(line.id))ref.lineIds.push(line.id)
   refs.set(p.id,ref)
  }
 }
 return {...document,lines:document.lines.map(l=>({...l,orderPurchases:[...(index.get(l.orderNumber)?.values()??[])].sort((a,b)=>a.number.localeCompare(b.number))}))}
}
module.exports={linkReturnPurchases}
