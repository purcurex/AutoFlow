#!/usr/bin/env node
// Talks only to the explicitly selected local BFF. FOP pause is enforced by the backend.
const args=process.argv.slice(2), options={}
for(let i=0;i<args.length;i++){
  const key=args[i]
  if(['--run','--configure'].includes(key)){options[key]=true;continue}
  if(!['--company-id','--request-key'].includes(key)||!args[i+1])throw new Error('Use [--configure] or --company-id UUID --request-key KEY [--run]')
  options[key]=args[++i]
}
const origin=new URL(process.env.WORKBENCH_API_URL??'http://127.0.0.1:3000/api/')
if(!['127.0.0.1','localhost','[::1]'].includes(origin.hostname)||!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.search||origin.hash)throw new Error('WORKBENCH_API_URL must be an explicit loopback BFF API base')
const token=process.env.WORKBENCH_ADMIN_TOKEN
if(!token)throw new Error('Set WORKBENCH_ADMIN_TOKEN to the local administrator session token')
if(!options['--configure']&&(!/^[0-9a-f-]{36}$/i.test(options['--company-id']??'')||!/^[A-Za-z0-9:_-]{1,96}$/.test(options['--request-key']??'')))throw new Error('Explicit --company-id and --request-key are required')
const suffix=options['--configure']?'configure':options['--run']?'':'status'
const response=await fetch(new URL(`workbench/replica/bootstrap${suffix?'/'+suffix:''}`,origin),{method:'POST',redirect:'error',signal:AbortSignal.timeout(300000),headers:{'content-type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(options['--configure']?{}:{companyId:options['--company-id'],requestKey:options['--request-key']})})
const value=await response.json()
console.log(JSON.stringify({httpStatus:response.status,result:value},null,2))
if(!response.ok)process.exitCode=1
