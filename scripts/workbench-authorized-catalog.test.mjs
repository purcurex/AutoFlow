import test from 'node:test'
import assert from 'node:assert/strict'
import {validateCatalogPage} from './workbench-authorized-catalog-capture.mjs'
const scope=()=>({pageNo:1,pageSize:100,seen:new Set(),companyId:'100000',orgNumber:'hyperzone.test'})
const fixture=()=>({status:true,errorCode:'0',data:{filter:"[org.id = 100000 AND org.number = 'hyperzone.test' AND org.name = '杭州华智云服科技有限公司']",pageNo:1,pageSize:100,totalCount:1,lastPage:true,rows:[{id:'9007199254740993',createorg_id:'100000'}]}})
test('accepts company-scoped complete pages including Chinese organization name',()=>assert.equal(validateCatalogPage(fixture(),scope()),1))
test('rejects duplicate IDs, scope mismatch, changed totals and incomplete final page',()=>{
 for(const mode of ['duplicate','company','total','missing','or']){const b=fixture(),s=scope();if(mode==='duplicate')s.seen.add(b.data.rows[0].id);if(mode==='company')b.data.rows[0].createorg_id='200000';if(mode==='total')s.total=2;if(mode==='missing')b.data.rows=[];if(mode==='or')b.data.filter+=" OR org.id = 200000";assert.throws(()=>validateCatalogPage(b,s),undefined,mode)}
})
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {loadCatalog} from './workbench-authorized-catalog-import.mjs'
test('offline import rejects edited captures and unfinished scans before database writes',t=>{
 const dir=mkdtempSync(join(tmpdir(),'hz-catalog-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const raw=JSON.stringify(fixture()),file='page-0001.json',identity={tenantId:'tenant',companyId:'100000',orgNumber:'hyperzone.test'};
 const m={...identity,operation:'receipt',complete:true,rows:1,pages:[{file,sha256:createHash('sha256').update(raw).digest('hex')}]};writeFileSync(join(dir,file),raw);writeFileSync(join(dir,'manifest.json'),JSON.stringify(m));assert.equal(loadCatalog(dir,identity).rows.length,1);
 writeFileSync(join(dir,file),raw+' ');assert.throws(()=>loadCatalog(dir,identity),/hash/);writeFileSync(join(dir,file),raw);writeFileSync(join(dir,'manifest.json'),JSON.stringify({...m,complete:false}));assert.throws(()=>loadCatalog(dir,identity),/scope/)
})
import {catalogFingerprint} from './workbench-authorized-catalog-import.mjs'
test('unchanged catalogues ignore record/key order but retain business changes',()=>{
 const a=[{id:'1',amount:2},{id:'2',amount:3}],b=[{amount:3,id:'2'},{amount:2,id:'1'}];assert.equal(catalogFingerprint(a),catalogFingerprint(b));assert.notEqual(catalogFingerprint(a),catalogFingerprint([{id:'1',amount:9},a[1]]))
})
