/** Verify real migrations in a disposable PostgreSQL database; never migrate the configured business DB. */
import {Client} from 'pg'
import {config} from 'dotenv'
import {resolve,join} from 'node:path'
import {readdirSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
const root=resolve(import.meta.dirname,'../..')
config({path:join(root,'backend/.env'),quiet:true})
const database=`hz_deploy_test_${Date.now()}`
const options={host:process.env.DB_HOST,port:Number(process.env.DB_PORT||5432),user:process.env.DB_USERNAME,password:process.env.DB_PASSWORD,ssl:process.env.DB_SSL==='true'?{rejectUnauthorized:process.env.DB_SSL_REJECT_UNAUTHORIZED!=='false'}:false}
const admin=new Client({...options,database:process.env.DB_DATABASE})
const output=join(root,'deployment/database')
const source=join(root,'backend/src/database/migrations'),compiled=join(root,'backend/dist/src/database/migrations')
const names=readdirSync(source).filter(n=>/^\d.*\.ts$/.test(n)).sort()
const binaries=readdirSync(compiled).filter(n=>/^\d.*\.js$/.test(n)).sort()
if(JSON.stringify(names.map(n=>n.replace(/\.ts$/,'.js')))!==JSON.stringify(binaries))throw Error('source_compiled_migrations_mismatch_rebuild_required')
const env={...process.env,DB_DATABASE:database}
let created=false,db
try{
 await admin.connect();await admin.query(`CREATE DATABASE "${database}"`);created=true
 const run=()=>execFileSync(process.execPath,['scripts/deployment/migrate-compiled.mjs','run'],{cwd:root,env,encoding:'utf8',maxBuffer:8*1024*1024})
 const first=run(),second=run()
 if(!second.includes('Executed migrations: 0'))throw Error('migration_rerun_not_idempotent')
 db=new Client({...options,database});await db.connect()
 const migrations=(await db.query('SELECT timestamp::text,name FROM typeorm_migrations ORDER BY timestamp')).rows
 if(migrations.length!==names.length)throw Error('migration_count_mismatch')
 const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename)
 for(const name of ['users','organization_employees','hz_fop_collected_orders','hz_fop_collected_entities','hz_fop_relation_refresh'])if(!tables.includes(name))throw Error('missing_table_'+name)
 if(Number((await db.query('SELECT count(*) FROM users')).rows[0].count)!==0)throw Error('unexpected_seed_accounts')
 for(const test of ['production-database.test.mjs','production-bootstrap.test.mjs'])execFileSync(process.execPath,['--test','scripts/deployment/'+test],{cwd:root,env,encoding:'utf8',maxBuffer:8*1024*1024})
 const invalid=(await db.query('SELECT indexrelid::regclass::text FROM pg_index WHERE NOT indisvalid OR NOT indisready')).rows
 if(invalid.length)throw Error('invalid_indexes')
 const constraints=(await db.query("SELECT count(*)::int n FROM pg_constraint WHERE connamespace='public'::regnamespace")).rows[0].n
 const indexes=(await db.query("SELECT count(*)::int n FROM pg_indexes WHERE schemaname='public'")).rows[0].n
 const pgDump=process.env.PG_DUMP_PATH||'pg_dump'
 let sql=execFileSync(pgDump,['--schema-only','--no-owner','--no-privileges','--host',options.host||'localhost','--port',String(options.port),'--username',options.user,'--dbname',database],{env:{...process.env,PGPASSWORD:options.password,PGSSLMODE:options.ssl?'require':'disable'},encoding:'utf8',maxBuffer:32*1024*1024})
 sql=sql.replace(/^\\(?:un)?restrict .*\n/gm,'')
 mkdirSync(output,{recursive:true})
 writeFileSync(join(output,'schema-reference.sql'),'-- Reference only. Initialize using migrate-compiled.mjs run; not this SQL.\n'+sql.trimEnd()+'\n')
 const hashes=Object.fromEntries(names.map(n=>[n,createHash('sha256').update(readFileSync(join(source,n))).digest('hex')]))
 const report={asOf:new Date().toISOString(),initialization:'Run compiled migrations, do not import schema-reference.sql as initialization.',count:migrations.length,migrations,sourceHashes:hashes,verification:{emptyDatabase:true,rerunExecuted:0,tables:tables.length,indexes,constraints,seedUsersBeforeBootstrap:0,bootstrapVerified:true,invalidIndexes:0,productionLiveValidated:false},tables}
 writeFileSync(join(output,'migration-inventory.json'),JSON.stringify(report,null,2)+'\n')
 console.log(JSON.stringify(report.verification));console.log(`Verified ${migrations.length} migrations. Reference SQL and inventory updated.`)
}finally{
 if(db)await db.end()
 if(created)await admin.query(`DROP DATABASE "${database}"`)
 await admin.end()
}
