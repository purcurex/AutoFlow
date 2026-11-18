import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {buildProductionPackage} from './build-production-package.mjs'
test('package whitelist excludes real config, source captures, uploads and executable tests; includes manifest hashes',async()=>{
 const root=mkdtempSync(join(tmpdir(),'hz-package-test-'))
 const write=(p,s='{}')=>{mkdirSync(join(root,p,'..'),{recursive:true});writeFileSync(join(root,p),s)}
 try{
  for(const p of ['package.json','package-lock.json','backend/package.json','frontend/package.json','backend/dist/src/main.js','backend/dist/src/database/workbench-schema.js','backend/dist/src/database/migrations/123-test.js','backend/dist/src/modules/workbench-replica/timestamp-postgres.js','backend/dist/public/index.html','deployment/.env.production.example','docs/manuals/HyperZone生产部署指导手册.html','docs/requirements/HyperZone智能办公平台项目开发需求说明书.html'])write(p)
  write('scripts/deployment/sync-worker-files.json','["workbench-scheduled-sync.mjs"]');write('scripts/workbench-scheduled-sync.mjs')
  for(const p of ['migrate-compiled.mjs','initialize-production.mjs','production-readiness.mjs','verify-runtime.mjs','verify-package.mjs'])write('scripts/deployment/'+p)
  for(const p of ['backend/.env','backend/.env.fop.local','backend/uploads/customer.csv','backend/dist/src/fail.spec.js','.runtime/raw.json','deployment/secret.env'])write(p,'DO_NOT_SHIP_SECRET')
  const result=await buildProductionPackage({root,version:'test-release',sourceRevision:'fixture',allowDirty:true})
  const manifest=JSON.parse(readFileSync(join(result.directory,'release-manifest.json'),'utf8'))
  assert.ok(existsSync(join(result.directory,'backend/dist/src/database/workbench-schema.js')));assert.ok(existsSync(result.archive));assert.match(readFileSync(result.archive+'.sha256','utf8'),/^[a-f0-9]{64} /)
  assert.ok(manifest.files.some(f=>f.path==='backend/dist/public/index.html'&&/^[a-f0-9]{64}$/.test(f.sha256)))
  for(const p of ['backend/.env','backend/.env.fop.local','backend/uploads/customer.csv','backend/dist/src/fail.spec.js','.runtime/raw.json','deployment/secret.env'])assert.equal(existsSync(join(result.directory,p)),false,p)
  await assert.rejects(buildProductionPackage({root,version:'../escape',sourceRevision:'fixture'}),/version/)
 }finally{rmSync(root,{recursive:true,force:true})}
})
