// Explicit dedicated-Mock repair; no source requests, no user/organization changes.
process.env.TS_NODE_PROJECT='backend/tsconfig.json'
require('ts-node').register({transpileOnly:true})
const fs=require('node:fs'), {DataSource}=require('typeorm'), dotenv=require('dotenv'), {ConfigService}=require('@nestjs/config')
const {workbenchMockEnabled,assertMockDatabase}=require('../backend/src/modules/workbench-replica/workbench-mock')
const {populateMockPurchaseEntries}=require('../backend/src/database/mock-purchase-entries')
const {WorkbenchPurchaseSalesNumber1794408000000}=require('../backend/src/database/migrations/1794408000000-WorkbenchPurchaseSalesNumber')
;(async()=>{
 const c={...dotenv.parse(fs.readFileSync('backend/.env.workbench.local')),NODE_ENV:'test'}
 if(!workbenchMockEnabled(new ConfigService(c)))throw new Error('Dedicated Mock environment required')
 const db=await new DataSource({type:'postgres',host:c.DB_HOST,port:Number(c.DB_PORT),username:c.DB_USERNAME,password:c.DB_PASSWORD,database:c.DB_DATABASE,migrationsTableName:'typeorm_migrations',migrations:[WorkbenchPurchaseSalesNumber1794408000000],logging:false}).initialize()
 try{assertMockDatabase(db);await db.runMigrations();await db.transaction(async m=>{await m.query("SELECT pg_advisory_xact_lock(hashtextextended('schema-mock-write',0))");await populateMockPurchaseEntries(m)});console.log('Mock purchase source entries and sales numbers updated; no FOP requests.')}
 finally{await db.destroy()}
})().catch(e=>{console.error(e.message);process.exitCode=1})
