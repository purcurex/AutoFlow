import { ConfigService } from '@nestjs/config'
import { DataSource } from 'typeorm'
import { ReplicaBootstrapService } from './replica-bootstrap.service'
import { ReplicaHttpSource } from './replica-http-source'
import { ReplicaPublisher } from './replica-publisher'
import { ReplicaAuthorizationService } from './replica-authorization.service'

it('reports missing initialization configuration without revealing credentials or calling FOP', async () => {
  const source = { isConfigured: () => false, begin: jest.fn() } as unknown as ReplicaHttpSource
  const db = { query: jest.fn().mockResolvedValueOnce([{ id: 'actor' }]).mockResolvedValueOnce([]) } as unknown as DataSource
  const service = new ReplicaBootstrapService(db, new ConfigService({ FOP_REPLICA_ACCESS_TOKEN: 'private-token' }), source, {} as ReplicaPublisher, {} as ReplicaAuthorizationService)
  const result = await service.readiness('actor')
  expect(result).toMatchObject({ allowed: true, executable: false, configured: false })
  expect(result.missingConfiguration).toContain('FOP_REPLICA_SNAPSHOT_BEGIN_URL')
  expect(JSON.stringify(result)).not.toContain('private-token')
  expect(source.begin).not.toHaveBeenCalled()
})

it('does not disclose initialization configuration or pending batches to a non-administrator', async () => {
  const db = { query: jest.fn().mockResolvedValue([]) } as unknown as DataSource
  const service = new ReplicaBootstrapService(db, new ConfigService({}), {} as ReplicaHttpSource, {} as ReplicaPublisher, {} as ReplicaAuthorizationService)
  expect(await service.readiness('user')).toEqual({ allowed: false })
  expect(db.query).toHaveBeenCalledTimes(1)
})

it('requires an active workspace administrator before source calls',async()=>{
  const source={begin:jest.fn(),isConfigured:()=>true} as unknown as ReplicaHttpSource
  const service=new ReplicaBootstrapService({query:async()=>[]} as unknown as DataSource,new ConfigService({}),source,{} as ReplicaPublisher,{} as ReplicaAuthorizationService)
  await expect(service.initialize('actor','company','key')).rejects.toThrow('workbench_bootstrap_forbidden')
  expect(source.begin).not.toHaveBeenCalled()
})
it('does not connect to source or mutate a database while paused',async()=>{
  const source={begin:jest.fn(),isConfigured:()=>true} as unknown as ReplicaHttpSource
  const db={query:jest.fn().mockResolvedValue([{connection_id:'c',company_id:'co'}])} as unknown as DataSource
  const service=new ReplicaBootstrapService(db,new ConfigService({FOP_QUERIES_PAUSED:'true'}),source,{} as ReplicaPublisher,{} as ReplicaAuthorizationService)
  await expect(service.initialize('actor','company','key')).rejects.toThrow('fop_queries_paused')
  expect(source.begin).not.toHaveBeenCalled()
})
