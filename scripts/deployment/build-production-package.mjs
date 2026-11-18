import {cpSync,existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync,createWriteStream,lstatSync} from 'node:fs'
import {resolve,join,dirname,relative} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import archiver from 'archiver'
const rootDefault=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
const runtimeFiles=['migrate-compiled.mjs','initialize-production.mjs','production-readiness.mjs','verify-runtime.mjs','verify-package.mjs']
const optionalFiles=['docs/openapi/fop-query-timestamp-capabilities.json','docs/openapi/fop-api-field-audit-20261116.json','docs/openapi/fop-replica-service-contract.json','docs/openapi/fop-replica-domain.schema.json','docs/requirements/requirements-current-review.json','docs/requirements/api-integration-verification-20261116.json','deployment/database/schema-reference.sql','deployment/database/migration-inventory.json','docs/requirements/production-release-verification.json','deployment/postgres.env.example','deployment/docker-compose.postgres.yml','deployment/production-inputs.csv','deployment/account-bindings.template.csv','deployment/hyperzone.service.example','deployment/nginx.conf.example','scripts/deployment/install-runtime.ps1','scripts/deployment/start-production.ps1','scripts/deployment/backup-database.ps1','scripts/deployment/restore-database.ps1','scripts/deployment/verify-runtime.ps1','scripts/deployment/migrate-database.ps1']
const digest=file=>createHash('sha256').update(readFileSync(file)).digest('hex')
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{const p=join(dir,entry.name);if(entry.isSymbolicLink())throw Error('package_symlink_forbidden');return entry.isDirectory()?walk(p):[p]})}
function compiledAllowed(path){return !/(^|\/)(test|tests)(\/|$)|\.(spec|test)\.|\.map$|\.d\.ts$|\.tsbuildinfo$/.test(path)&&(!path.startsWith('backend/dist/src/database/')||path.startsWith('backend/dist/src/database/migrations/')||['backend/dist/src/database/workbench-schema.sql.js','backend/dist/src/database/workbench-schema.js'].includes(path))}
export async function buildProductionPackage({root=rootDefault,version,sourceRevision,allowDirty=false}={}){
 if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,70}$/.test(version??''))throw Error('package_invalid_version')
 const name='HyperZone-Production-'+version,directory=join(root,'artifacts',name),archive=directory+'.zip'
 if(existsSync(directory)||existsSync(archive))throw Error('package_version_already_exists')
 const fixed=['package.json','package-lock.json','backend/package.json','frontend/package.json','deployment/.env.production.example','docs/manuals/HyperZone生产部署指导手册.html','docs/requirements/HyperZone智能办公平台项目开发需求说明书.html',...runtimeFiles.map(f=>'scripts/deployment/'+f)]
 const workers=JSON.parse(readFileSync(join(root,'scripts/deployment/sync-worker-files.json'),'utf8'))
 if(!Array.isArray(workers)||workers.some(f=>!/^[-a-z]+\.mjs$/.test(f)))throw Error('package_invalid_worker_manifest')
 fixed.push('scripts/deployment/sync-worker-files.json',...workers.map(f=>'scripts/'+f))
 for(const p of [...fixed,'backend/dist/src/main.js','backend/dist/public/index.html','backend/dist/src/database/migrations','backend/dist/src/modules/workbench-replica/timestamp-postgres.js'])if(!existsSync(join(root,p)))throw Error('package_missing_'+p)
 const sourceFiles=[...fixed,...optionalFiles.filter(p=>existsSync(join(root,p))),...walk(join(root,'backend/dist')).map(p=>relative(root,p).replaceAll('\\','/')).filter(compiledAllowed)]
 mkdirSync(directory,{recursive:true})
 for(const p of new Set(sourceFiles)){if(lstatSync(join(root,p)).isSymbolicLink())throw Error('package_symlink_forbidden');mkdirSync(dirname(join(directory,p)),{recursive:true});cpSync(join(root,p),join(directory,p))}
 cpSync(join(root,'deployment/.env.production.example'),join(directory,'backend/.env.example'))
 mkdirSync(join(directory,'backend/uploads'),{recursive:true})
 writeFileSync(join(directory,'backend/uploads/README.txt'),'Persistent uploads. Keep outside release replacement; back up separately.\n')
 writeFileSync(join(directory,'README.txt'),'Open docs/manuals/HyperZone生产部署指导手册.html.\nInstall Node.js 22 and PostgreSQL 16; run npm ci --omit=dev on the target host.\nNo secrets, accounts or business data are included. Production values and source acceptance remain pending.\n')
 const files=walk(directory).map(p=>({path:relative(directory,p).replaceAll('\\','/'),sha256:digest(p)})).sort((a,b)=>a.path.localeCompare(b.path))
 const manifest={schemaVersion:1,version,sourceRevision:sourceRevision??null,workingTreeSnapshot:allowDirty,builtAt:new Date().toISOString(),nodeVersion:process.version,dependencyInstall:'npm ci --omit=dev on target platform',productionLiveValidated:false,files}
 writeFileSync(join(directory,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n')
 await new Promise((done,fail)=>{const out=createWriteStream(archive),zip=archiver('zip',{zlib:{level:9}});out.on('close',done);out.on('error',fail);zip.on('error',fail);zip.on('warning',fail);zip.pipe(out);zip.directory(directory,name);zip.finalize().catch(fail)})
 writeFileSync(archive+'.sha256',digest(archive)+'  '+name+'.zip\n')
 return {directory,archive,sha256:digest(archive),files:files.length,productionLiveValidated:false}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const version=process.argv[2]
 try{const dirty=execFileSync('git',['status','--porcelain'],{cwd:rootDefault,encoding:'utf8'}).trim();if(dirty&&!process.argv.includes('--allow-working-tree'))throw Error('package_requires_clean_commit_or_explicit_working_tree');const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:rootDefault,encoding:'utf8'}).trim();console.log(JSON.stringify(await buildProductionPackage({version,sourceRevision:revision,allowDirty:!!dirty}),null,2))}catch(error){console.error(error.message);process.exitCode=1}
}
