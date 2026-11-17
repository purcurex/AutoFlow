import { planCapturedEmployeeBindings } from './captured-employee-bindings'
const scope={workspaceOwnerId:'workspace',tenantId:'tenant',companyId:'100000'}
const fop={id:'123',masterId:'456',number:'E1',username:'Jennie',state:'active',userForbidden:false}
const capture={status:true,errorCode:'0',data:{subject:{tenantId:'tenant'},organizationId:'100000',resource:'employees',checkedAt:'2026-01-01T00:00:00Z',scopeVersion:'v1',nextCursor:null,items:[fop]}}
const selected=[{accountId:'account',localEmployeeId:'local',fop:{...fop,employeeNumber:'E1'}}]
const employees=[{id:'local',owner_user_id:'workspace',account_id:'account',name:'叶力铭',fop_user_id:'123',fop_tenant_id:'tenant'}]
describe('captured directory reconciliation',()=>{
 it('uses a confirmed person selection and directory master ID, not the person or authentication ID',()=>{
  const result=planCapturedEmployeeBindings(capture,selected,employees,scope)
  expect(result[0]).toMatchObject({localAccountId:'account',personRecordId:'123',employeeMasterId:'456',localEmployeeId:'local'})
 })
 it('does not link an identical name without a selected account/employee pair',()=>{
  expect(planCapturedEmployeeBindings(capture,selected,[{...employees[0],id:'same-name',account_id:'other'}],scope)).toEqual([])
 })
 it.each([{account_disabled:true},{archived_at:'2026-01-01'},{binding_id:'existing'}])('does not overwrite stopped or existing assignments %j',change=>{
  expect(planCapturedEmployeeBindings(capture,selected,[{...employees[0],...change}],scope)).toEqual([])
 })
 it.each([{fop_user_id:'999'},{fop_tenant_id:'other'},{owner_user_id:'other'}])('rejects changed identity or scope %j',change=>{
  expect(()=>planCapturedEmployeeBindings(capture,selected,[{...employees[0],...change}],scope)).toThrow()
 })
 it.each([{organizationId:'other'},{nextCursor:'more'},{subject:{tenantId:'other'}},{items:[{...fop,state:'disabled'}]},{items:[fop,fop]}])('rejects unverified source %j',change=>{
  expect(()=>planCapturedEmployeeBindings({...capture,data:{...capture.data,...change}},selected,employees,scope)).toThrow()
 })
})
