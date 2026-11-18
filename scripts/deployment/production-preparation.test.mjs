import test from 'node:test'
import assert from 'node:assert/strict'
import {productionReadiness} from './production-readiness.mjs'
const base={NODE_ENV:'production',DB_HOST:'db.internal',DB_PORT:'5432',DB_DATABASE:'hyperzone',DB_USERNAME:'hyperzone',DB_PASSWORD:'a-secure-database-secret',DB_SYNCHRONIZE:'false',DB_MIGRATIONS_RUN:'false',JWT_SECRET:'x'.repeat(48),SMTP_HOST:'mail.internal',SMTP_USER:'service',SMTP_PASS:'mail-secret',WORKBENCH_READ_MODE:'local',WORKBENCH_MOCK_ENABLED:'false',FOP_QUERIES_PAUSED:'true',WORKBENCH_SYNC_ENABLED:'false',WORKBENCH_AUTOMATIC_CALLS_ENABLED:'false',WORKBENCH_TIMESTAMP_SYNC_ENABLED:'false',WORKBENCH_COLLECTED_ENABLED:'false'}
test('database preparation permits source IDs to remain absent, never says source is ready',()=>{const r=productionReadiness(base);assert.equal(r.databaseReady,true);assert.equal(r.sourceConfigurationReady,false);assert.equal(r.upstreamCalled,false);assert.ok(r.missingSource.includes('FOP_REPLICA_COMPANY_ID'))})
test('placeholders, schema auto-sync, accidental source enablement and mixed production modes fail preparation',()=>{
 for(const patch of [{DB_PASSWORD:'replace-with-a-strong-database-password'},{JWT_SECRET:'replace-with-at-least-32-random-characters'},{DB_SYNCHRONIZE:'true'},{DB_MIGRATIONS_RUN:'true'},{NODE_ENV:'development'},{FOP_QUERIES_PAUSED:'false'}])assert.equal(productionReadiness({...base,...patch}).databaseReady,false)
 assert.ok(!JSON.stringify(productionReadiness({...base,DB_PASSWORD:'private-secret'})).includes('private-secret'))
})

test('production mail dependency preserves SMTP message construction without sending mail',async()=>{
 const {createRequire}=await import('node:module');const require=createRequire(new URL('../../backend/package.json',import.meta.url));const mail=require('nodemailer')
 const transport=mail.createTransport({jsonTransport:true});const sent=await transport.sendMail({from:'system@example.invalid',to:'user@example.invalid',subject:'deployment-check',html:'<p>verification</p>'});const message=JSON.parse(sent.message)
 assert.equal(message.to[0].address,'user@example.invalid');assert.equal(message.subject,'deployment-check');assert.equal(message.html,'<p>verification</p>')
})

test('source readiness requires explicit production mode and real provider selection',()=>{
 for(const config of [base,{...base,WORKBENCH_TIMESTAMP_ENVIRONMENT:'test',FOP_DATA_MODE:'demo'}]){const result=productionReadiness(config);assert.ok(result.missingSource.includes('WORKBENCH_TIMESTAMP_ENVIRONMENT=production'));assert.ok(result.missingSource.includes('FOP_DATA_MODE=kingdee'))}
})
