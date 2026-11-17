import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { collectedOrganizationQuery } from './collected-organization-query'
import { buildReplicaOrganization } from './local-workbench-organization'
import { localEmployeeFilter, localOwnership } from '../fop-data/local-workbench-scope'
import { User } from '../users/user.entity'

const database=process.env.EMPLOYEE_DIRECTORY_TEST_DB
const integration=database?.startsWith('hz_ddl_validation_')?describe:describe.skip
integration('collected directory SQL authorization',()=>{
 let db:any
 const user={id:'account',role:'user',businessRole:'salesperson'} as User
 const nodes=[{id:'root',parent_id:null,kind:'organization',name:'Company'},{id:'marketing',parent_id:'root',kind:'department',name:'营销中心'},{id:'dept',parent_id:'marketing',kind:'department',name:'业务三部'}]
 const organization=async()=>buildReplicaOrganization(user,'workspace',nodes,(await db.query(collectedOrganizationQuery,['workspace','tenant','100000'])).rows,{tenant_id:'tenant',source_company_id:'100000'})
 beforeAll(async()=>{const {Client}=require('pg');db=new Client({host:'127.0.0.1',port:55432,user:'autoflow_demo',database,password:readFileSync(resolve(__dirname,'../../../../.runtime/local-demo/database-password'),'utf8').trim()});await db.connect()})
 afterAll(async()=>{await db?.end()})
 beforeEach(async()=>{
  await db.query(`BEGIN;
   CREATE TEMP TABLE organization_employees(id text,owner_user_id text,department_id text,account_id text,name text,directory_profile jsonb,archived_at timestamptz) ON COMMIT DROP;
   CREATE TEMP TABLE users(id text,account_disabled boolean,fop_tenant_id text,fop_user_id text,fop_binding_details jsonb) ON COMMIT DROP;
   CREATE TEMP TABLE hz_fop_connections(id text,workspace_owner_id text,tenant_id text,status text,capabilities jsonb) ON COMMIT DROP;
   CREATE TEMP TABLE hz_fop_companies(connection_id text,source_company_id text,enabled boolean) ON COMMIT DROP;
   CREATE TEMP TABLE hz_fop_employee_bindings(id text,connection_id text,local_account_id text,enabled boolean,state text,employee_master_id text,person_record_id text,employee_number text,directory_verified_at timestamptz,evidence jsonb) ON COMMIT DROP;
   INSERT INTO organization_employees VALUES('employee','workspace','dept','account','叶力铭','{"englishName":"Jennie"}',null);
   INSERT INTO users VALUES('account',false,'tenant','123','{"localEmployeeId":"employee","organizationId":"100000","employeeMasterId":"456","employeeRecordId":"123","employeeNumber":"E1","verifiedAt":"2026-01-01T00:00:00Z"}');
   INSERT INTO hz_fop_connections VALUES('connection','workspace','tenant','disabled','{"offlineCollectedOnly":true}');
   INSERT INTO hz_fop_companies VALUES('connection','100000',false);
   INSERT INTO hz_fop_employee_bindings VALUES('binding','connection','account',true,'directory_verified','456','123','E1','2026-01-01',
    '{"source":"captured_employee_directory","workspaceOwnerId":"workspace","tenantId":"tenant","companyId":"100000","localEmployeeId":"employee","selectedFopUserId":"123"}');`)
 })
 afterEach(async()=>{await db.query('ROLLBACK')})
 it('joins offline directory evidence to the local name, department, filter and self scope',async()=>{
  const org=await organization()
  expect(org.employeeIds).toEqual(['456'])
  expect(localOwnership({owner:{id:'456',name:'source'}},org)).toMatchObject({owner:{name:'叶力铭（Jennie）'},department:{id:'dept',name:'业务三部'}})
  expect(localEmployeeFilter(org,{departmentId:'dept'}).employeeIds).toEqual(['456'])
  expect(()=>localEmployeeFilter(org,{ownerId:'other'})).toThrow()
 })
 it.each([
  "UPDATE hz_fop_employee_bindings SET enabled=false",
  "UPDATE hz_fop_employee_bindings SET state='conflict'",
  "UPDATE hz_fop_employee_bindings SET evidence=jsonb_set(evidence,'{companyId}','\"other\"')",
  "UPDATE hz_fop_employee_bindings SET evidence=jsonb_set(evidence,'{localEmployeeId}','\"other\"')",
  "UPDATE users SET fop_user_id='999'",
  "UPDATE users SET account_disabled=true",
  "UPDATE hz_fop_connections SET capabilities='{}'",
 ])('rejects changed/stopped proof without resurrecting legacy binding: %s',async mutation=>{
  await db.query(mutation)
  await expect(organization()).rejects.toThrow('Verified local employee')
 })
})
