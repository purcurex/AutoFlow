import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { randomUUID } from 'node:crypto'
import { DataSource, QueryRunner } from 'typeorm'
import { WorkbenchCollectedOrders1794411000000 } from '../../database/migrations/1794411000000-WorkbenchCollectedOrders'
import { CollectedEntities1794480000000 } from '../../database/migrations/1794480000000-CollectedEntities'
import { CollectedAnalyticsFacts1794500000000 } from '../../database/migrations/1794500000000-CollectedAnalyticsFacts'
import { PersistedExceptionState1794980000000 } from '../../database/migrations/1794980000000-PersistedExceptionState'
import { ExceptionCommitProbe1794987000000 } from '../../database/migrations/1794987000000-ExceptionCommitProbe'

const database = process.env.EXCEPTION_PAGE_TEST_DB
const integration = database && /^hz_ddl_validation_sync_\d+$/.test(database) ? describe : describe.skip
integration('deferred exception commit event probe', () => {
  let db: DataSource, q: QueryRunner, schema: string
  const migration = new ExceptionCommitProbe1794987000000()
  beforeAll(async () => {
    const config = parseEnv(readFileSync(resolve(__dirname, '../../../.env.workbench.local'), 'utf8'))
    if (!['localhost', '127.0.0.1'].includes(config.DB_HOST ?? '') || config.DB_PORT !== '55432') throw Error('isolated_test_local_database_required')
    db = await new DataSource({ type: 'postgres', host: config.DB_HOST, port: +config.DB_PORT, username: config.DB_USERNAME, database,
      password: config.DB_PASSWORD }).initialize()
    q = db.createQueryRunner(); await q.connect()
    schema = 'exception_commit_' + Date.now(); await q.query(`CREATE SCHEMA ${schema}`); await q.query(`SET search_path TO ${schema},public`)
    for (const M of [WorkbenchCollectedOrders1794411000000, CollectedEntities1794480000000, CollectedAnalyticsFacts1794500000000, PersistedExceptionState1794980000000]) await new M().up(q)
    const before = await q.query("SELECT pg_get_functiondef('hz_exception_evaluate_order_v1(uuid,text,boolean)'::regprocedure) AS evaluator,pg_get_functiondef('hz_exception_recheck_v1(uuid,text,text,boolean)'::regprocedure) AS recheck,pg_get_functiondef('hz_exception_flush_v1(uuid)'::regprocedure) AS flush")
    await migration.up(q)
    expect(await q.query("SELECT pg_get_functiondef('hz_exception_evaluate_order_v1(uuid,text,boolean)'::regprocedure) AS evaluator,pg_get_functiondef('hz_exception_recheck_v1(uuid,text,text,boolean)'::regprocedure) AS recheck,pg_get_functiondef('hz_exception_flush_v1(uuid)'::regprocedure) AS flush")).toEqual(before)
    // Count actual flush invocations while delegating to the untouched production flush/evaluator.
    await q.query('ALTER FUNCTION hz_exception_flush_v1(uuid) RENAME TO hz_exception_flush_actual')
    await q.query('CREATE TABLE flush_calls(batch_id uuid NOT NULL,transaction_id bigint NOT NULL)')
    await q.query(`CREATE FUNCTION hz_exception_flush_v1(p_batch uuid) RETURNS void LANGUAGE plpgsql AS $$
      BEGIN INSERT INTO flush_calls VALUES(p_batch,txid_current()); PERFORM hz_exception_flush_actual(p_batch); END $$`)
  })
  afterEach(async () => { if (q?.isTransactionActive) await q.rollbackTransaction() })
  afterAll(async () => {
    if (q) { if (q.isTransactionActive) await q.rollbackTransaction(); await q.query('SET search_path TO public'); if (schema) await q.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await q.release() }
    await db?.destroy()
  })
  const batch = async () => {
    const id = randomUUID()
    await q.query("INSERT INTO hz_fop_collected_batches(id,workspace_owner_id,tenant_id,company_id,state,source_as_of) VALUES($1,$2,'tenant','100000','active',now())", [id, randomUUID()])
    return id
  }
  const orders = (id: string, count: number, status = '6') => q.query(`INSERT INTO hz_fop_collected_orders(batch_id,source_id,order_number,raw_bill_status,raw_order_status,raw_payment_status,raw_delivery_status,search_text,display,raw)
    SELECT $1,n::text,'TO'||n,'C',$3,'1','2','TO'||n,'{"businessStatus":{"outbound":"completed"}}'::jsonb,
      jsonb_build_object('id',n::text,'billno','TO'||n,'hzkj_logistics_info',jsonb_build_array(jsonb_build_object('hzkj_tracking_number','QC'))) FROM generate_series(1,$2::integer) n`, [id, count, status])
  const calls = async (id: string) => (await q.query('SELECT count(*)::int n FROM flush_calls WHERE batch_id=$1', [id]))[0].n
  const marks = async (id: string): Promise<{ is_exception: boolean; exception_reason: string | null }[]> => q.query('SELECT is_exception,exception_reason FROM hz_fop_collected_orders WHERE batch_id=$1 ORDER BY source_id', [id])
  const dirty = (id: string) => q.query('SELECT * FROM hz_fop_exception_dirty WHERE batch_id=$1', [id])
  it('flushes a large dirty batch once, evaluates every final order and leaves no dirty rows', async () => {
    const id = await batch(); await q.startTransaction(); await orders(id, 400)
    expect((await dirty(id)).length).toBe(401)
    await q.commitTransaction()
    expect(await calls(id)).toBe(1)
    const results = await marks(id); expect(results).toHaveLength(400)
    expect(results.every(row => row.is_exception && row.exception_reason === '取消履约')).toBe(true)
    expect(await dirty(id)).toEqual([])
    expect((await q.query('SELECT revision FROM hz_fop_exception_versions WHERE batch_id=$1', [id]))[0].revision).toBe('1')
  })
  it('flushes each batch once without merging batches or changing their classifications', async () => {
    const first = await batch(), second = await batch(); await q.startTransaction()
    await orders(first, 12); await orders(second, 13, '4'); await q.commitTransaction()
    expect(await calls(first)).toBe(1); expect(await calls(second)).toBe(1)
    expect((await marks(first)).every(row => row.is_exception)).toBe(true)
    expect((await marks(second)).every(row => !row.is_exception)).toBe(true)
  })
  it('allows new dirty work after an earlier flush, including reinsertion of the same event key', async () => {
    const id = await batch(); await orders(id, 1, '4'); await q.query('DELETE FROM flush_calls WHERE batch_id=$1', [id])
    await q.startTransaction()
    await q.query("UPDATE hz_fop_collected_orders SET raw_order_status='6' WHERE batch_id=$1", [id])
    await q.query('SELECT hz_exception_flush_v1($1)', [id])
    expect((await marks(id))[0].is_exception).toBe(true)
    await q.query("UPDATE hz_fop_collected_orders SET raw_order_status='4' WHERE batch_id=$1", [id])
    await q.commitTransaction()
    expect(await calls(id)).toBe(2); expect((await marks(id))[0]).toEqual({ is_exception: false, exception_reason: null })
    expect(await dirty(id)).toEqual([])
  })
  it('skips deleted event keys while still processing a later live event', async () => {
    const id = await batch(); await q.startTransaction()
    await q.query("INSERT INTO hz_fop_exception_dirty(batch_id,document_kind,source_id) VALUES($1,'revision','gone'),($1,'revision','live')", [id])
    await q.query("DELETE FROM hz_fop_exception_dirty WHERE batch_id=$1 AND source_id='gone'", [id])
    await q.commitTransaction()
    expect(await calls(id)).toBe(1); expect(await dirty(id)).toEqual([])
  })
  it('queued callbacks after explicit processing or whole-batch deletion do not flush again', async () => {
    const id = await batch(); await q.startTransaction(); await orders(id, 3)
    await q.query('SELECT hz_exception_flush_v1($1)', [id]); await q.commitTransaction()
    expect(await calls(id)).toBe(1)
    const removed = await batch(); await q.startTransaction(); await orders(removed, 4)
    await q.query('DELETE FROM hz_fop_collected_batches WHERE id=$1', [removed]); await q.commitTransaction()
    expect(await calls(removed)).toBe(0); expect(await dirty(removed)).toEqual([])
  })
  it('does not process another transaction identity and rolls back evaluations with source changes', async () => {
    const id = await batch(); await q.startTransaction()
    await q.query("INSERT INTO hz_fop_exception_dirty(batch_id,document_kind,source_id,transaction_id) VALUES($1,'revision','foreign',txid_current()-1)", [id])
    await q.commitTransaction(); expect(await calls(id)).toBe(0); expect(await dirty(id)).toHaveLength(1)
    await q.query('DELETE FROM hz_fop_exception_dirty WHERE batch_id=$1', [id])
    await q.startTransaction(); await orders(id, 1); await q.query('SELECT hz_exception_flush_v1($1)', [id]); await q.rollbackTransaction()
    expect(await calls(id)).toBe(0); expect(await marks(id)).toEqual([]); expect(await dirty(id)).toEqual([])
  })
})
