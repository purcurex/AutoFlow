/** The supplied return API currently identifies rows by billno, not by source ID. */
export function validateMaterialReturnPage(data,pageNo,pageSize,expectedTotal,seen){
 if(!data||data.pageNo!==pageNo||data.pageSize!==pageSize||!Array.isArray(data.rows)||data.rows.length>pageSize||!Number.isSafeInteger(data.totalCount)||data.totalCount<0||typeof data.lastPage!=='boolean')throw Error('invalid_return_page')
 if(!data.filter?.includes('org in (100000)'))throw Error('unverified_return_company')
 if(expectedTotal!==undefined&&data.totalCount!==expectedTotal)throw Error('changed_return_total')
 for(const row of data.rows){
  if(typeof row.billno!=='string'||!row.billno.trim()||seen.has(row.billno))throw Error('duplicate_return_number')
  if(row.org_id!=null&&row.org_id!=='100000')throw Error('return_company_mismatch')
  seen.add(row.billno)
 }
 if(seen.size>data.totalCount||data.lastPage&&seen.size!==data.totalCount||!data.lastPage&&(!data.rows.length||seen.size>=data.totalCount))throw Error('incomplete_return_pages')
 return data.totalCount
}
