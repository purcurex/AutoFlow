import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {Client} from 'pg'
const enabled=/^hz_deploy_test_\d+$/.test(process.env.DB_DATABASE??'')
test('all compiled migrations initialize an empty database and rerun with zero work',{skip:!enabled},async()=>{
 const run=()=>spawnSync(process.execPath,['scripts/deployment/migrate-compiled.mjs','run'],{encoding:'utf8',env:process.env,maxBuffer:1024*1024})
 const first=run();assert.equal(first.status,0,first.stdout+'\n'+first.stderr)
 const second=run();assert.equal(second.status,0,second.stderr);assert.match(second.stdout,/Executed migrations: 0/)
 const c=new Client({host:process.env.DB_HOST,port:+process.env.DB_PORT,user:process.env.DB_USERNAME,password:process.env.DB_PASSWORD,database:process.env.DB_DATABASE});await c.connect()
 try{const r=await c.query("SELECT to_regclass('hz_fop_timestamp_state') AS sync,to_regclass('organization_employees') AS employees");assert.ok(r.rows[0].sync);assert.ok(r.rows[0].employees);assert.equal((await c.query('SELECT count(*)::int AS n FROM users')).rows[0].n,0)}finally{await c.end()}
})
