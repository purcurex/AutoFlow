type Row=Record<string,any>
/** Reconcile previously selected account/person pairs against captured directory evidence.
 * Never discover associations by names. Does not verify a personal FOP execution identity.
 */
export function planCapturedEmployeeBindings(capture:Row,selections:Row[],employees:Row[],scope:{workspaceOwnerId:string;tenantId:string;companyId:string}):Row[]{
  const d=capture.data,numeric=(v:unknown)=>typeof v==='string'&&/^[1-9]\d{0,18}$/.test(v)
  if(capture.status!==true||String(capture.errorCode)!=='0'||d?.resource!=='employees'
    ||d.subject?.tenantId!==scope.tenantId||d.organizationId!==scope.companyId||d.nextCursor!==null
    ||!d.scopeVersion||!Number.isFinite(Date.parse(d.checkedAt))||Date.parse(d.checkedAt)>Date.now()||!Array.isArray(d.items))throw Error('invalid_directory_capture')
  const byId=new Map<string,Row>()
  for(const item of d.items){if(!numeric(item.id)||byId.has(item.id))throw Error('ambiguous_directory');byId.set(item.id,item)}
  const plans:Row[]=[],accounts=new Set(),masters=new Set()
  for(const e of employees){
    if(e.archived_at||e.account_disabled||!e.account_id||e.binding_id)continue
    const selected=selections.filter(s=>s.accountId===e.account_id&&s.localEmployeeId===e.id)
    if(!selected.length)continue
    if(selected.length!==1)throw Error('ambiguous_selection')
    const s=selected[0].fop,person=byId.get(s?.id)
    if(e.owner_user_id!==scope.workspaceOwnerId||e.fop_tenant_id!==scope.tenantId||e.fop_user_id!==s?.id)throw Error('local_selection_changed')
    if(!person||person.state!=='active'||person.userForbidden!==false||!numeric(person.masterId)
      ||person.masterId!==s.masterId||person.number!==s.employeeNumber||!person.number?.trim()
      ||!person.username?.trim()||person.username!==s.username)throw Error('directory_selection_changed')
    if(accounts.has(e.account_id)||masters.has(person.masterId))throw Error('ambiguous_employee_mapping')
    accounts.add(e.account_id);masters.add(person.masterId)
    plans.push({localAccountId:e.account_id,localEmployeeId:e.id,personRecordId:person.id,employeeMasterId:person.masterId,
      employeeNumber:person.number,username:person.username,displayName:e.name,directoryVerifiedAt:d.checkedAt,
      evidence:{source:'captured_employee_directory',...scope,localEmployeeId:e.id,selectedFopUserId:e.fop_user_id,
        scopeVersion:d.scopeVersion,checkedAt:d.checkedAt,authenticationProxyVerified:false}})
  }
  return plans
}
