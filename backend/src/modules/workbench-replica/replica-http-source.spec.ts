import { ConfigService } from '@nestjs/config'
import { DataSource } from 'typeorm'
import { ReplicaHttpSource } from './replica-http-source'
import { REPLICA_API_KEYS } from './replica-source-api'

const scope = {connectionId:'c',companyId:'co',datasetId:'d'}
const settings = Object.fromEntries(REPLICA_API_KEYS.map(key=>[`FOP_REPLICA_${key}_URL`,`https://fop.invalid/${key}`]))
const config = (extra={}) => new ConfigService({...settings,FOP_REPLICA_ACCESS_TOKEN:'service-token',...extra})
const db = {query:async()=>[{tenant_id:'tenant',source_company_id:'company'}]} as unknown as DataSource
const envelope = (data:unknown, extra={}) => new Response(JSON.stringify({success:true,data:{schemaVersion:'fop-replica/1',tenantId:'tenant',companyId:'company',...data as object,...extra}}))
const snapshot = {snapshotId:'snapshot',scopeVersion:'v1',sourceAsOf:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),entityCodes:['hzkj_orders'],streams:[{key:'business',endCursor:'snapshot-end'}]}

it('blocks all source and token activity while paused',async()=>{
  const request=jest.fn();const source=new ReplicaHttpSource(config({FOP_QUERIES_PAUSED:'true'}),db,request)
  await expect(source.begin(scope,'key')).rejects.toThrow('fop_queries_paused')
  expect(request).not.toHaveBeenCalled()
})
it('requires every independent endpoint and a service credential',()=>{
  expect(new ReplicaHttpSource(config(),db).isConfigured()).toBe(true)
  expect(new ReplicaHttpSource(config({FOP_REPLICA_CHANGES_URL:''}),db).isConfigured()).toBe(false)
  expect(new ReplicaHttpSource(config({FOP_REPLICA_ACCESS_TOKEN:''}),db).isConfigured()).toBe(false)
})
it('sends a scoped idempotent snapshot request using a service identity',async()=>{
  const request=jest.fn().mockResolvedValue(envelope(snapshot));const source=new ReplicaHttpSource(config(),db,request)
  expect(await source.begin(scope,'key')).toMatchObject(snapshot)
  const [,options]=request.mock.calls[0]
  expect(JSON.parse(options.body)).toMatchObject({tenantId:'tenant',companyId:'company',requestKey:'key'})
  expect(options.headers.access_token).toBe('service-token');expect(options.redirect).toBe('error')
})
it.each([{companyId:'other'},{schemaVersion:'old'},{expiresAt:'2020-01-01T00:00:00Z'},{entityCodes:[]}])('rejects invalid source identity or manifest %j',async extra=>{
  const source=new ReplicaHttpSource(config(),db,jest.fn().mockResolvedValue(envelope(snapshot,extra)))
  await expect(source.begin(scope,'key')).rejects.toThrow()
})
it('does not blindly retry a timeout or issue credentials to HTTP',async()=>{
  const request=jest.fn().mockRejectedValue(new Error('timeout'))
  await expect(new ReplicaHttpSource(config(),db,request).begin(scope,'key')).rejects.toThrow('fop_replica_request_failed')
  expect(request).toHaveBeenCalledTimes(1)
  expect(new ReplicaHttpSource(config({FOP_REPLICA_BARRIER_URL:'http://fop.invalid'}),db).isConfigured()).toBe(false)
})
it('requires an explicit complete authorization resource manifest',async()=>{
  const source=new ReplicaHttpSource(config(),db,jest.fn().mockResolvedValue(envelope({scopeVersion:'v1',sourceAsOf:snapshot.sourceAsOf,expiresAt:snapshot.expiresAt,companyAllowed:true,resources:[],employees:[],references:[]})))
  await expect(source.authorization(scope)).rejects.toThrow('fop_replica_invalid_authorization')
})
