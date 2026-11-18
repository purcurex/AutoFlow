import {readFileSync} from 'node:fs'
import {resolve,sep} from 'node:path'
import {createHash} from 'node:crypto'
const root=resolve(import.meta.dirname,'../..')
try{
 const manifest=JSON.parse(readFileSync(resolve(root,'release-manifest.json'),'utf8'))
 if(manifest.schemaVersion!==1||!Array.isArray(manifest.files)||!manifest.files.length)throw Error('invalid_manifest')
 for(const file of manifest.files){const p=resolve(root,file.path);if(!p.startsWith(root+sep)||!/^[a-f0-9]{64}$/.test(file.sha256)||createHash('sha256').update(readFileSync(p)).digest('hex')!==file.sha256)throw Error('file_hash_mismatch')}
 console.log(JSON.stringify({verified:true,files:manifest.files.length,version:manifest.version,productionLiveValidated:false}))
}catch{console.error('production_package_verification_failed');process.exitCode=1}
