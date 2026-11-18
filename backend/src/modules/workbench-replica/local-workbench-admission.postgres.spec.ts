// pg is an optional runtime boundary for this isolated SQL test, without typed client usage.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require('pg')
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { buildLocalOrderQuery } from './local-workbench-query'

// Opt-in, self-created Unix-socket PostgreSQL only. Never reads application credentials or a real database.
const isolated = process.env.RUN_LOCAL_QUEUE_ISOLATED_SQL_TEST === '1' ? describe : describe.skip
isolated('formal warehouse admission in isolated PostgreSQL', () => {
  let root: string, db: any, started = false
  const connection=randomUUID(), company=randomUUID(), dataset=randomUUID(), order=randomUUID()
  const run = (cmd: string, args: string[]) => execFileSync(cmd,args,{stdio:'pipe'})
  beforeAll(async () => {
    root=mkdtempSync(join(tmpdir(),'hz-local-queue-'))
    run('initdb',['-D',join(root,'data'),'-A','trust','--no-locale','-U','queue_test'])
    run('pg_ctl',['-D',join(root,'data'),'-l',join(root,'server.log'),'-o',`-F -p 55597 -k ${root} -c listen_addresses=''`,'-w','start']);started=true

    db=new Client({host:root,port:55597,user:'queue_test',database:'postgres'});await db.connect()
    await db.query(`
      CREATE TABLE hz_fop_workbench_orders(document_id uuid,connection_id uuid,company_id uuid,dataset_id uuid,order_kind text,owner_employee_id text,outbound_state text,customer_paid_at timestamptz);
      CREATE TABLE hz_fop_source_documents(id uuid,connection_id uuid,company_id uuid,dataset_id uuid,source_id text,entity_code text,document_number text,raw_bill_status text,validation_state text,deleted_at timestamptz,source_audited_at timestamptz);
      CREATE TABLE hz_fop_fulfillment_orders(document_id uuid,company_id uuid,dataset_id uuid);
      CREATE TABLE hz_fop_workbench_memberships(order_document_id uuid,company_id uuid,dataset_id uuid,queue_code text,classification_state text);
      CREATE TABLE hz_fop_resource_grants(connection_id uuid,company_id uuid,resource_type text,target_key text,decision text,verified_at timestamptz,source_as_of timestamptz,expires_at timestamptz);
      CREATE TABLE hz_fop_document_relations(from_document_id uuid,to_document_id uuid,connection_id uuid,company_id uuid,dataset_id uuid,relation_type text,resolution_state text,removed_at timestamptz);
      CREATE TABLE hz_fop_dispatches(document_id uuid,company_id uuid,dataset_id uuid,raw_delivery_status text);
      CREATE TABLE hz_fop_tracking_numbers(dispatch_document_id uuid,connection_id uuid,company_id uuid,dataset_id uuid,removed_at timestamptz,tracking_type text,number text);
      CREATE TABLE hz_fop_allocations(document_id uuid,company_id uuid,dataset_id uuid,raw_allocation_status text);
    `)
  },30000)
  afterAll(async () => {
    await db?.end()
    if(started)run('pg_ctl',['-D',join(root,'data'),'-m','fast','-w','stop'])
    if(root)rmSync(root,{recursive:true,force:true})
  })
  beforeEach(async () => {
    await db.query(`TRUNCATE hz_fop_workbench_orders,hz_fop_source_documents,hz_fop_fulfillment_orders,hz_fop_workbench_memberships,hz_fop_resource_grants,hz_fop_document_relations,hz_fop_dispatches,hz_fop_tracking_numbers,hz_fop_allocations`)
    await db.query(`INSERT INTO hz_fop_workbench_orders VALUES($1,$2,$3,$4,'fulfillment','owner','pending',now());
    `.trim(),[order,connection,company,dataset])
    await source(order,'hzkj_orders','C')
    await db.query(`INSERT INTO hz_fop_resource_grants VALUES($1,$2,'orders','*','allow',now(),now(),now()+interval '60 seconds')`,[connection,company])
    await db.query(`INSERT INTO hz_fop_workbench_memberships VALUES($1,$2,$3,'shipping','member'),($1,$2,$3,'warehouse_completed','member')`,[order,company,dataset])
  })
  async function source(id: string, entity: string, audit: string) {
    await db.query(`INSERT INTO hz_fop_source_documents VALUES($1::uuid,$2,$3,$4,($1::uuid)::text,$5,'N-'||($1::uuid)::text,$6,'verified',NULL,now())`,[id,connection,company,dataset,entity,audit])
  }
  async function link(id: string, type: string, resolution='resolved') {
    await db.query(`INSERT INTO hz_fop_document_relations VALUES($1,$2,$3,$4,$5,$6,$7,NULL)`,[order,id,connection,company,dataset,type,resolution])
  }
  async function allocation(state='completed', audit='C') {
    const id=randomUUID();await source(id,'hzkj_alloc_bill',audit);await link(id,'allocation')
    await db.query(`INSERT INTO hz_fop_allocations VALUES($1,$2,$3,$4)`,[id,company,dataset,state]);return id
  }
  async function dispatch(audit='C',state='FULFILLED') {
    const id=randomUUID();await source(id,'hzkj_deliver_bill',audit);await link(id,'dispatch')
    await db.query(`INSERT INTO hz_fop_dispatches VALUES($1,$2,$3,$4)`,[id,company,dataset,state]);return id
  }
  async function rows(completed=false,employees=['owner']) {
    const q=buildLocalOrderQuery([{connectionId:connection,companyId:company,datasetId:dataset,employeeIds:employees}],{queue:'shipping',completed})
    return (await db.query(`SELECT o.document_id ${q.from} WHERE ${q.where} AND m.classification_state='member'`,q.values)).rows
  }
  it('requires an approved active dispatch and completed approved allocation', async () => {
    expect(await rows()).toHaveLength(0)
    await allocation();expect(await rows()).toHaveLength(0)
    const d=await dispatch('B');expect(await rows()).toHaveLength(0)
    await db.query(`UPDATE hz_fop_source_documents SET raw_bill_status='C' WHERE id=$1`,[d]);expect(await rows()).toHaveLength(1)
    await db.query(`UPDATE hz_fop_dispatches SET raw_delivery_status='CANCELLED' WHERE document_id=$1`,[d]);expect(await rows()).toHaveLength(0)
  })
  it('ignores voided allocations but excludes unresolved or unverified live links', async () => {
    await allocation();await allocation('voided','A');await dispatch();expect(await rows()).toHaveLength(1)
    const missing=randomUUID();await link(missing,'allocation','pending');expect(await rows()).toHaveLength(0)
    await db.query(`DELETE FROM hz_fop_document_relations WHERE to_document_id=$1`,[missing])
    const a=await allocation();await db.query(`UPDATE hz_fop_source_documents SET validation_state='unverified' WHERE id=$1`,[a]);expect(await rows()).toHaveLength(0)
  })
  it('rejects unresolved dispatch evidence even alongside a valid approved dispatch', async () => {
    await allocation();await dispatch();await link(randomUUID(),'dispatch','pending');expect(await rows()).toHaveLength(0)
  })
  it('keeps owner and explicit deny restrictions after admission', async () => {
    await allocation();await dispatch();expect(await rows(false,['different-owner'])).toHaveLength(0)
    await db.query(`INSERT INTO hz_fop_resource_grants VALUES($1,$2,'orders',$3,'deny',now(),now(),now()+interval '60 seconds')`,[connection,company,order])
    expect(await rows()).toHaveLength(0)
  })
  it('does not require pending admission facts for completed outbound', async () => {
    await db.query(`UPDATE hz_fop_workbench_orders SET outbound_state='completed'`)
    expect(await rows(true)).toHaveLength(1)
  })
})
