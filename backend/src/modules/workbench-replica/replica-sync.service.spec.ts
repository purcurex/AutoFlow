import { ConfigService } from '@nestjs/config'
import { DataSource } from 'typeorm'
import { ReplicaSyncService } from './replica-sync.service'
import { UnconfiguredReplicaChangeSource } from './replica-change-contract'
import { LocalWorkbenchService } from './local-workbench.service'
import { ReplicaPublisher } from './replica-publisher'

it('reports an uninitialized local database without contacting a source', async () => {
  const source = new UnconfiguredReplicaChangeSource()
  const service = new ReplicaSyncService({} as DataSource, { enabled: true, replicaScope: async () => [] } as unknown as LocalWorkbenchService,
    new ConfigService({ FOP_QUERIES_PAUSED: 'true' }), source, {} as ReplicaPublisher)
  expect(await service.status('actor')).toMatchObject({ readMode: 'local', initialized: false, state: 'not_initialized', paused: true, sourceSyncedAt: null, nextScheduledAt: null, syncConfigured: false, capabilities: { historicalImport: { implemented: true, executable: false }, incrementalSync: { configured: false, executable: false } } })
  await expect(service.request('actor', 'one')).rejects.toMatchObject({ response: { code: 'workbench_replica_not_initialized' } })
})
it('checks local account scope even when a sync source is paused', async () => {
  const service = new ReplicaSyncService({} as DataSource, { enabled: true, replicaScope: async () => { throw new Error('Account disabled') } } as unknown as LocalWorkbenchService,
    new ConfigService({ FOP_QUERIES_PAUSED: 'true' }), new UnconfiguredReplicaChangeSource(), {} as ReplicaPublisher)
  await expect(service.status('disabled')).rejects.toThrow('Account disabled')
})
it('does not start background activity while paused or unconfigured', () => {
  const service = new ReplicaSyncService({} as DataSource, { enabled: true } as LocalWorkbenchService,
    new ConfigService({ WORKBENCH_SYNC_ENABLED: 'true', FOP_QUERIES_PAUSED: 'true' }), new UnconfiguredReplicaChangeSource(), {} as ReplicaPublisher)
  const timer = jest.spyOn(global, 'setInterval')
  service.onModuleInit()
  expect(timer).not.toHaveBeenCalled()
  timer.mockRestore()
})
it('keeps the demand worker available when automatic scheduling is disabled', () => {
  const source = new UnconfiguredReplicaChangeSource()
  jest.spyOn(source, 'isConfigured').mockReturnValue(true)
  const service = new ReplicaSyncService({} as DataSource, { enabled: true } as LocalWorkbenchService,
    new ConfigService({ WORKBENCH_SYNC_ENABLED: 'false', FOP_QUERIES_PAUSED: 'false' }), source, {} as ReplicaPublisher)
  const timer = jest.spyOn(global, 'setInterval')
  try { service.onModuleInit(); expect(timer).toHaveBeenCalledTimes(1) }
  finally { service.onModuleDestroy(); timer.mockRestore() }
})
it('never starts the source worker for a mock database even with a configured source', () => {
  const source = new UnconfiguredReplicaChangeSource()
  jest.spyOn(source, 'isConfigured').mockReturnValue(true)
  const service = new ReplicaSyncService({} as DataSource, { enabled: true, mock: true } as LocalWorkbenchService,
    new ConfigService({ WORKBENCH_SYNC_ENABLED: 'true', FOP_QUERIES_PAUSED: 'false' }), source, {} as ReplicaPublisher)
  const timer = jest.spyOn(global, 'setInterval')
  try { service.onModuleInit(); expect(timer).not.toHaveBeenCalled() }
  finally { service.onModuleDestroy(); timer.mockRestore() }
})

it('disables navigation, timers and retry workers independently from manual operations', async () => {
  const source = new UnconfiguredReplicaChangeSource()
  jest.spyOn(source, 'isConfigured').mockReturnValue(true)
  const db = { transaction: jest.fn(), query: jest.fn() } as unknown as DataSource
  const local = { enabled: true, mock: false, replicaScope: async () => [{ connectionId: 'c', companyId: 'co', datasetId: 'd' }] } as unknown as LocalWorkbenchService
  const service = new ReplicaSyncService(db, local, new ConfigService({ WORKBENCH_AUTOMATIC_CALLS_ENABLED: 'false', WORKBENCH_SYNC_ENABLED: 'true' }), source, {} as ReplicaPublisher)
  const timer = jest.spyOn(global, 'setInterval')
  try {
    service.onModuleInit()
    expect(timer).not.toHaveBeenCalled()
    expect(await service.request('actor', 'navigation', 'navigation')).toMatchObject({ state: 'skipped', reason: 'workbench_automatic_calls_disabled' })
    await service.tick()
    expect(db.transaction).not.toHaveBeenCalled()
  } finally { service.onModuleDestroy(); timer.mockRestore() }
})

it('only drives the explicitly polled actor batch in manual-only mode', async () => {
  const source = new UnconfiguredReplicaChangeSource(); jest.spyOn(source, 'isConfigured').mockReturnValue(true)
  const manager = { query: jest.fn(async () => []) }
  const db = { query: jest.fn(async () => [{ connection_id: 'c', company_id: 'co', dataset_id: 'd', state: 'pending_barrier' }]), transaction: jest.fn(async run => run(manager)) } as unknown as DataSource
  const local = { enabled: true, replicaScope: async () => [{ connectionId: 'c', companyId: 'co', datasetId: 'd' }] } as unknown as LocalWorkbenchService
  const service = new ReplicaSyncService(db, local, new ConfigService({ WORKBENCH_AUTOMATIC_CALLS_ENABLED: 'false' }), source, {} as ReplicaPublisher)
  service.onModuleInit()
  try {
    expect(await service.job('actor', 'manual-batch')).toMatchObject({ state: 'pending' })
    await Promise.resolve()
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining("explicit_request.requested_scope->>'trigger'='manual'"), ['actor','manual-batch'])
  } finally { service.onModuleDestroy() }
})

it('does not drive a batch after the account loses its company scope', async () => {
  const source = new UnconfiguredReplicaChangeSource(); jest.spyOn(source, 'isConfigured').mockReturnValue(true)
  const db = { query: jest.fn(async () => [{ connection_id: 'other', company_id: 'co', dataset_id: 'd', state: 'pending_barrier' }]), transaction: jest.fn() } as unknown as DataSource
  const service = new ReplicaSyncService(db, { enabled: true, replicaScope: async () => [] } as unknown as LocalWorkbenchService,
    new ConfigService({ WORKBENCH_AUTOMATIC_CALLS_ENABLED: 'false' }), source, {} as ReplicaPublisher)
  service.onModuleInit()
  try { expect(await service.job('actor', 'batch')).toMatchObject({ errorCode: 'workbench_scope_changed' }); expect(db.transaction).not.toHaveBeenCalled() }
  finally { service.onModuleDestroy() }
})
