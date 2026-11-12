// Update only synthetic logistics facts; never reset orders, accounts or business states.
require('reflect-metadata')
require('ts-node').register({project:'backend/tsconfig.json',transpileOnly:true})
const fs=require('node:fs'),{DataSource}=require('typeorm'),dotenv=require('dotenv')
const {ConfigService}=require('@nestjs/config')
const {repairMockLogistics}=require('../backend/src/database/mock-logistics')
const {workbenchMockEnabled}=require('../backend/src/modules/workbench-replica/workbench-mock')
;(async()=>{
 const config={...dotenv.parse(fs.readFileSync('backend/.env.workbench.local')),NODE_ENV:process.env.NODE_ENV??'test'}
 if(!workbenchMockEnabled(new ConfigService(config)))throw new Error('Select the dedicated mock environment before repairing logistics')
 const db=await new DataSource({type:'postgres',host:config.DB_HOST,port:Number(config.DB_PORT),username:config.DB_USERNAME,password:config.DB_PASSWORD,database:config.DB_DATABASE,logging:false}).initialize()
 try{console.log(JSON.stringify({source:'mock',updatedFulfillmentOrders:await repairMockLogistics(db)}))}finally{await db.destroy()}
})().catch(error=>{console.error(error.message);process.exitCode=1})
