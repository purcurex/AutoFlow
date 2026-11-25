/** Current single-company deployment: missing capture ownership inherits the Huazhi batch.
 * Explicit ownership, relation verification and employee permissions are never rewritten.
 */
export function defaultCollectedCompany<T extends Record<string,any>>(batch:T):T {
 if(batch.company_id!=='100000'||!batch.metadata)return batch
 const metadata={...batch.metadata}
 for(const group of ['entityCaptures','analyticsCaptures']){
  if(!metadata[group]||typeof metadata[group]!=='object'||Array.isArray(metadata[group]))continue
  metadata[group]=Object.fromEntries(Object.entries(metadata[group]).map(([key,value])=>{
   if(!value||typeof value!=='object'||Array.isArray(value))return [key,value]
   const capture=value as Record<string,any>
   const missing=capture.companyId==null||typeof capture.companyId==='string'&&!capture.companyId.trim()
   return [key,missing?{...capture,companyId:batch.company_id,companyDefaultBasis:'huazhi_single_company'}:capture]
  }))
 }
 return {...batch,metadata}
}
