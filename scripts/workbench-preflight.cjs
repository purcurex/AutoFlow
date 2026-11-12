#!/usr/bin/env node
// Read-only local audit. Never starts Nest, FOP clients, workers, migrations or seeders.
const fs = require('node:fs'), path = require('node:path'), { parseEnv } = require('node:util')
const { Client } = require('pg')
const root = path.resolve(__dirname, '..')
require('ts-node').register({ project: path.join(root,'backend/tsconfig.json'), transpileOnly:true })
const { WORKBENCH_TABLE_COLUMNS } = require('../backend/src/database/workbench-schema')
const { replicaReadiness } = require('../backend/src/modules/workbench-replica/replica-readiness')
const { ReplicaHttpSource } = require('../backend/src/modules/workbench-replica/replica-http-source')
const { ConfigService } = require('@nestjs/config')
async function main() {
  const args=process.argv.slice(2), allowed=new Set(['--env-file','--database','--output'])
  const options={}
  for(let i=0;i<args.length;i+=2){ if(!allowed.has(args[i])||!args[i+1]||options[args[i]])throw Error('Use --env-file PATH [--database NAME] [--output PATH]'); options[args[i]]=args[i+1] }
  if(!options['--env-file'])throw Error('An explicit local --env-file is required')
  const env=parseEnv(fs.readFileSync(path.resolve(options['--env-file']),'utf8'))
  const database=options['--database']||env.DB_DATABASE
  if(!['localhost','127.0.0.1','::1'].includes(env.DB_HOST)||!(/^(autoflow_local_demo|autoflow_workbench_mock|hz_ddl_validation_\d+)$/.test(database||'')))throw Error('Only the named local replica, Mock or validation databases may be inspected')
  const client=new Client({host:env.DB_HOST,port:Number(env.DB_PORT),user:env.DB_USERNAME,password:env.DB_PASSWORD,database,connectionTimeoutMillis:5000})
  await client.connect()
  try {
    await client.query('BEGIN READ ONLY')
    await client.query("SET LOCAL statement_timeout='10s'")
    const columns=(await client.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name LIKE 'hz_fop_%'")).rows
    const actual=new Map(); for(const c of columns){if(!actual.has(c.table_name))actual.set(c.table_name,new Set());actual.get(c.table_name).add(c.column_name)}
    const missing=[];for(const [table,fields] of Object.entries(WORKBENCH_TABLE_COLUMNS))for(const f of fields)if(!actual.get(table)?.has(f))missing.push(table+'.'+f)
    const migrationTable=(await client.query("SELECT to_regclass('public.typeorm_migrations') IS NOT NULL AS present")).rows[0].present
    const applied=migrationTable?(await client.query('SELECT name FROM typeorm_migrations ORDER BY timestamp')).rows.map(r=>r.name):[]
    const migrationFiles=fs.readdirSync(path.join(root,'backend/src/database/migrations')).filter(f=>/^\d.*\.ts$/.test(f))
    const expected=migrationFiles.map(f=>{const source=fs.readFileSync(path.join(root,'backend/src/database/migrations',f),'utf8');return source.match(/name\s*=\s*['"]([^'"]+)['"]/)?.[1]||source.match(/export class (\w+)/)?.[1]}).filter(Boolean)
    const pending=expected.filter(name=>!applied.includes(name))
    const dataset=actual.has('hz_fop_datasets')?(await client.query('SELECT state,count(*)::int AS count FROM hz_fop_datasets GROUP BY state ORDER BY state')).rows:[]
    const documents=actual.has('hz_fop_source_documents')?(await client.query('SELECT count(*)::int AS count FROM hz_fop_source_documents')).rows[0].count:0
    const pauseFile=path.join(root,'backend/.env.fop-pause')
    const paused=(fs.existsSync(pauseFile)?parseEnv(fs.readFileSync(pauseFile,'utf8')).FOP_QUERIES_PAUSED:env.FOP_QUERIES_PAUSED)?.trim().toLowerCase()==='true'
    // Verify current DI wiring rather than treating endpoint configuration as a source implementation.
    const moduleSource=fs.readFileSync(path.join(root,'backend/src/modules/users/users.module.ts'),'utf8')
    if(!/provide:\s*REPLICA_CHANGE_SOURCE,\s*useExisting:\s*ReplicaHttpSource/.test(moduleSource))throw Error('Source wiring changed; update this audit before using its verdict')
    const sourceConfigured=new ReplicaHttpSource(new ConfigService(env),{}).isConfigured()
    const readiness=replicaReadiness({local:env.WORKBENCH_READ_MODE===undefined||env.WORKBENCH_READ_MODE==='local',mock:database==='autoflow_workbench_mock',paused,initialized:dataset.some(d=>d.state==='active'),sourceConfigured})
    const report={checkedAt:new Date().toISOString(),database,readOnly:true,fopContacted:false,tables:actual.size,columns:columns.length,appliedMigrations:applied.length,pendingMigrations:pending,missingColumns:missing,documents,datasets:dataset,capabilities:readiness,
      historicalImportReady:readiness.historicalImport.executable&&pending.length===0&&missing.length===0,implementationGaps:[],externalRequirements:['FOP stable snapshot/change feed and reconciliation APIs must be provided','Current service authorization and domain facts must be verified','Explicit FOP access restoration required while paused']}
    await client.query('ROLLBACK')
    if(options['--output'])fs.writeFileSync(path.resolve(options['--output']),JSON.stringify(report,null,2)+'\n',{mode:0o600})
    console.log(JSON.stringify(report,null,2))
  } finally { await client.end() }
}
main().catch(()=>{console.error('Local preflight failed; check the explicit local configuration, schema and source wiring. No FOP requests or database writes were made.');process.exitCode=1})
