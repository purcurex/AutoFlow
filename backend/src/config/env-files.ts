import { parse } from 'dotenv'
import { existsSync, readFileSync } from 'node:fs'
export function environmentFiles(env:Record<string,string|undefined>=process.env,base:string=existsSync('.env')?readFileSync('.env','utf8'):''):string[]{
 const config={...parse(base),...env}
 if(config.NODE_ENV==='production'||config.WORKBENCH_TIMESTAMP_ENVIRONMENT==='production')return ['.env']
 return ['.env.fop-pause','.env.workbench.local','.env.fop.local','.env.alibaba1688.local','.env.providers.local','.env']
}
