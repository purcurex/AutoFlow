// Isolated PostgreSQL fixtures in a temporary table; no upstream or persistent writes.
const fs=require('fs'),{parseEnv}=require('node:util'),assert=require('node:assert/strict')
require('ts-node').register({project:'backend/tsconfig.json',transpileOnly:true});require('reflect-metadata')
const {localFreightDetailsQuery}=require('../backend/src/modules/workbench-replica/local-freight-details')
const {localFreightQuery,aggregateLocalFreight}=require('../backend/src/modules/workbench-replica/local-freight')
async function main(){const e=parseEnv(fs.readFileSync('backend/.env.workbench.local','utf8')),{Client}=require('pg'),db=new Client({host:e.DB_HOST,port:+e.DB_PORT,user:e.DB_USERNAME,password:e.DB_PASSWORD,database:e.DB_DATABASE});await db.connect()
try{await db.query('BEGIN');await db.query(`CREATE TEMP TABLE hz_fop_collected_analytics_facts(source_id text DEFAULT md5(random()::text),document_number text DEFAULT 'FY-fixture',batch_id text,entity_type text,company_id text,raw jsonb,occurred_at timestamptz,raw_status text, facts jsonb DEFAULT '{}') ON COMMIT DROP`)
 const fixture=(patch={})=>({hzkj_bizoperator_id:'1',hzkj_logistics_providers_id:'7',hzkj_logistics_providers_name:'native',hzkj_actual_freight:'0.10',hzkj_textfield1:'RMB',hzkj_actual_weight:'500',hzkj_textfield2:'g',hzkj_basedatafield_number:'WH',hzkj_ship_block_state:'CANCELLED',...patch})
 const rows=[fixture(),fixture({hzkj_actual_freight:'0.2',hzkj_actual_weight:'invalid'}),fixture({hzkj_actual_freight:'99',hzkj_bizoperator_id:'outside'}),fixture({hzkj_actual_freight:'10',hzkj_textfield1:''}),fixture({hzkj_actual_freight:'50',hzkj_textfield1:'USD'}),fixture({hzkj_bizoperator_id:'precise',hzkj_actual_freight:'0.12345678901234567890'})]
 for(const r of rows)await db.query("INSERT INTO hz_fop_collected_analytics_facts(batch_id,entity_type,company_id,raw,occurred_at,raw_status) VALUES('b','dispatch','100000',$1,'2026-11-08T16:00:00Z','C')",[JSON.stringify(r)])
 const q={grain:'month',year:2026,currency:'CNY',dimension:'carrier'},now=new Date('2026-11-16T10:00:00Z'),s=localFreightQuery('b','100000',['1'],q,now)
 const result=(await db.query(s.sql,s.params)).rows[0],aggregate=aggregateLocalFreight(result.buckets,q,now)
 assert.equal(result.missing_currency,1);assert.equal(aggregate.totals.amount,'0.3');assert.equal(aggregate.billCount,2);assert.equal(aggregate.weightKg,'0.5');assert.equal(aggregate.costPerKg,'0.2')
 assert.equal(result.buckets[0].day,'2026-11-09');assert.deepEqual(result.currencies.sort(),['CNY','USD'])
 // Warehouse labels come from same-batch/company warehouse references, never guessed codes.
 await db.query(`INSERT INTO hz_fop_collected_analytics_facts(batch_id,entity_type,company_id,raw,facts) VALUES
 ('b','fulfillment','100000','{}','{"warehouse":{"number":"WH","name":"HangZhou"}}'),
 ('b','fulfillment','other','{}','{"warehouse":{"number":"WH","name":"Wrong company"}}'),
 ('old','fulfillment','100000','{}','{"warehouse":{"number":"WH","name":"Old name"}}')`)
 const ws=localFreightQuery('b','100000',['1'],{...q,dimension:'warehouse'},now)
 const named=(await db.query(ws.sql,ws.params)).rows[0]
 assert.equal(aggregateLocalFreight(named.buckets,{...q,dimension:'warehouse'},now).series[0].label,'HangZhou')
 assert.deepEqual(named.warehouse_options,[{id:'WH',name:'HangZhou'}])
 const bundle=localFreightQuery('b','100000',['1'],{...q,allDimensions:true},now)
 const bundled=(await db.query(bundle.sql,bundle.params)).rows[0]
 assert.equal(bundled.missing_currency,result.missing_currency)
 for(const dimension of ['carrier','channel','warehouse','country','customer','owner','department']){
  const single=localFreightQuery('b','100000',['1'],{...q,dimension},now)
  const singleResult=(await db.query(single.sql,single.params)).rows[0]
  assert.deepEqual(aggregateLocalFreight(bundled.buckets.filter(b=>b.dimension===dimension),{...q,dimension},now),aggregateLocalFreight(singleResult.buckets,{...q,dimension},now))
 }
 // Conflicting reference names must fall back to code, not select an arbitrary name.
 await db.query(`INSERT INTO hz_fop_collected_analytics_facts(batch_id,entity_type,company_id,raw,facts) VALUES('b','stock','100000','{}','{"warehouse":{"number":"WH","name":"Conflicting"}}')`)
 const conflicting=(await db.query(ws.sql,ws.params)).rows[0]
 assert.equal(conflicting.warehouse_options[0].name,'WH')
 const precise=localFreightQuery('b','100000',['precise'],q,now);assert.equal(aggregateLocalFreight((await db.query(precise.sql,precise.params)).rows[0].buckets,q,now).totals.amount,'0.1234567890123456789')
 const denied=localFreightQuery('b','100000',[],q,now);assert.deepEqual((await db.query(denied.sql,denied.params)).rows[0].buckets,[])
 // Details must be native headers, with the same precise sum and permissions as the chart.
 const detailQuery=localFreightDetailsQuery('b','100000',['1'],{...q,periodId:'2026-11',dimensionId:'7',page:1,pageSize:1},now)
 const details=(await db.query(detailQuery.sql,detailQuery.params)).rows[0]
 assert.equal(details.total,2);assert.equal(details.amount,'0.30');assert.equal(details.items.length,1)
 assert.equal(details.items[0].documentNumber,'FY-fixture');assert.equal(details.items[0].businessDay,'2026-11-09')
 const page2=localFreightDetailsQuery('b','100000',['1'],{...q,periodId:'2026-11',dimensionId:'7',page:2,pageSize:1},now)
 const second=(await db.query(page2.sql,page2.params)).rows[0];assert.notEqual(details.items[0].id,second.items[0].id)
 for(const patch of [{dimensionId:'no-match'}, {periodId:'2026-06'}, {warehouse:'outside'}]){
  const check=localFreightDetailsQuery('b','100000',['1'],{...q,...patch},now)
  assert.deepEqual((await db.query(check.sql,check.params)).rows[0],{total:0,amount:'0',items:[]})
 }
 const others=localFreightDetailsQuery('b','100000',['1'],{...q,dimensionId:'__others'},now,['7'])
 assert.equal((await db.query(others.sql,others.params)).rows[0].total,0)
 const preciseDetail=localFreightDetailsQuery('b','100000',['precise'],q,now)
 assert.equal((await db.query(preciseDetail.sql,preciseDetail.params)).rows[0].items[0].amount,'0.12345678901234567890')
 const noPermission=localFreightDetailsQuery('b','100000',[],q,now)
 assert.equal((await db.query(noPermission.sql,noPermission.params)).rows[0].total,0)
 const {shouldApplyDispatchSql}=require('./workbench-freight-import.cjs')
 const {normalizeCollectedAnalyticsFact}=require('../backend/src/modules/fop-data/collected-analytics-facts')
 const facts=time=>normalizeCollectedAnalyticsFact('dispatch',{id:'1',billno:'D1',modifytime:time},{companyId:'100000',scopeVerified:true,capturedAt:'2026-11-17T00:00:00Z'}).facts
 for(const [oldTime,newTime,expected] of [['2026-11-13T10:00:00+08:00','2026-11-13 10:00:00',true],['2026-11-13T10:00:00+08:00','2026-11-13 09:59:59',false],['2026-11-13T02:00:00Z','2026-11-13 10:00:01',true]]){
  const check=await db.query(`SELECT ${shouldApplyDispatchSql} AS apply FROM (SELECT $1::jsonb facts) hz_fop_collected_analytics_facts CROSS JOIN(SELECT $2::jsonb facts) excluded`,[JSON.stringify(facts(oldTime)),JSON.stringify(facts(newTime))]);assert.equal(check.rows[0].apply,expected)
 }
 await db.query('ROLLBACK');console.log(JSON.stringify({passed:true,checks:['native_document_details','details_pagination','details_scope_period_currency','details_other_group','details_exact_decimal','all_seven_dimension_bundle_equivalence','warehouse_names','warehouse_reference_scope','warehouse_name_conflict','decimal','20_digit_decimal','native_owner_scope','timezone','currency','cancellation_cost','grams','invalid_weight','empty_scope','same_instant_formats','reject_older_capture','accept_newer_capture'],persistentWrites:0}))
}finally{await db.end()}}
main().catch(e=>{console.error(e.message);process.exitCode=1})
