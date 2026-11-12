/* Reset synthetic business data only; the fixed mock database guard is enforced again by the seeder. */
require('reflect-metadata')
require('ts-node').register({project:'backend/tsconfig.json',transpileOnly:true})
const fs=require('node:fs'),{DataSource}=require('typeorm'),dotenv=require('dotenv')
const {seedWorkbenchMock}=require('../backend/src/database/seed-workbench-mock')
const {workbenchMockEnabled}=require('../backend/src/modules/workbench-replica/workbench-mock')
const {ConfigService}=require('@nestjs/config')
;(async()=>{
 const config={...dotenv.parse(fs.readFileSync('backend/.env.workbench.local')),NODE_ENV:process.env.NODE_ENV??'test'}
 if(!workbenchMockEnabled(new ConfigService(config)))throw new Error('Select the dedicated mock environment before resetting fixtures')
 const db=await new DataSource({type:'postgres',host:config.DB_HOST,port:Number(config.DB_PORT),username:config.DB_USERNAME,password:config.DB_PASSWORD,database:config.DB_DATABASE,logging:false}).initialize()
 try{console.log(JSON.stringify({database:config.DB_DATABASE,source:'mock',...await seedWorkbenchMock(db)}))}finally{await db.destroy()}
})().catch(error=>{console.error(error.message);process.exitCode=1})
