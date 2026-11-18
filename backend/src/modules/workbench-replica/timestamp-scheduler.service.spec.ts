import { EventEmitter } from 'node:events'
import { TimestampSchedulerService } from './timestamp-scheduler.service'
import { ReplicaSyncService } from './replica-sync.service'
import { ReplicaAuthorizationService } from './replica-authorization.service'
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
jest.mock('node:child_process', () => ({ spawn: jest.fn(), execFileSync:jest.fn() }))
jest.mock('node:fs', () => ({ ...jest.requireActual('node:fs'), existsSync: jest.fn(), realpathSync: jest.fn() }))
const enabled = { WORKBENCH_READ_MODE: 'local', FOP_QUERIES_PAUSED: 'false', WORKBENCH_COLLECTED_ENABLED: 'true', WORKBENCH_AUTOMATIC_CALLS_ENABLED: 'true', WORKBENCH_SYNC_ENABLED: 'true', WORKBENCH_TIMESTAMP_SYNC_ENABLED: 'true' }
const config = (values: Record<string, string>) => ({ get: (key: string) => values[key] }) as any
beforeEach(() => {
  jest.clearAllMocks()
  ;(existsSync as unknown as jest.Mock).mockReturnValue(true)
  ;(realpathSync as unknown as jest.Mock).mockImplementation(path => path)
})
it('owns one child, closes it on destroy and does not spawn after destruction', async () => {
  const child = Object.assign(new EventEmitter(), { kill: jest.fn(() => { queueMicrotask(() => child.emit('exit', 0)); return true }) })
  ;(spawn as jest.Mock).mockReturnValue(child)
  const service = new TimestampSchedulerService(config(enabled))
  service.onModuleInit(); service.onModuleInit()
  expect(spawn).toHaveBeenCalledTimes(1)
  expect((spawn as jest.Mock).mock.calls[0][1][0]).toBe('--max-old-space-size=8192')
  expect((spawn as jest.Mock).mock.calls[0][1][2]).toBe('--watch')
  await service.onModuleDestroy()
  expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  service.onModuleInit(); expect(spawn).toHaveBeenCalledTimes(1)
})
it('fails closed for disabled flags and scripts outside the project', () => {
  new TimestampSchedulerService(config({ ...enabled, WORKBENCH_TIMESTAMP_SYNC_ENABLED: 'false' })).onModuleInit()
  new TimestampSchedulerService(config({ ...enabled, WORKBENCH_TIMESTAMP_WORKER_PATH: '/tmp/evil.mjs' })).onModuleInit()
  expect(spawn).not.toHaveBeenCalled()
})
it('waits 30 minutes after a crash, coalesces error/exit, and cancels restart on shutdown', async () => {
  jest.useFakeTimers()
  try {
    const child = Object.assign(new EventEmitter(),{kill:jest.fn(()=>{queueMicrotask(()=>child.emit('exit'));return true})})
    ;(spawn as jest.Mock).mockReturnValue(child)
    const service = new TimestampSchedulerService(config(enabled)); service.onModuleInit()
    child.emit('error', Error('private details'));child.emit('exit')
    service.onModuleInit();jest.advanceTimersByTime(30*60*1000-1)
    expect(spawn).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(1);expect(spawn).toHaveBeenCalledTimes(2)
    child.emit('exit');await service.onModuleDestroy();jest.advanceTimersByTime(60*60*1000)
    expect(spawn).toHaveBeenCalledTimes(2)
  } finally { jest.useRealTimers() }
})
it('collected mode prevents both old schedulers and authorization source calls', async () => {
  const db = { query: jest.fn() }, source = { isConfigured: jest.fn(() => true), authorization: jest.fn() }
  const auth = new ReplicaAuthorizationService(db as any, config(enabled), source as any)
  auth.onModuleInit(); await auth.tick()
  await expect(auth.refresh({ connectionId: 'c', companyId: 'co' })).rejects.toThrow('workbench_replica_collected_mode')
  await expect(auth.ensure({ connectionId: 'c', companyId: 'co' })).rejects.toThrow('workbench_replica_collected_mode')
  const sync = new ReplicaSyncService(db as any, { enabled: true, mock: false } as any, config(enabled), source as any, {} as any)
  sync.onModuleInit(); await sync.tick()
  expect(db.query).not.toHaveBeenCalled(); expect(source.authorization).not.toHaveBeenCalled(); expect(source.isConfigured).not.toHaveBeenCalled()
  auth.onModuleDestroy(); sync.onModuleDestroy()
})
it('production refuses to launch a worker when offline configuration preflight fails',()=>{
 (execFileSync as jest.Mock).mockReturnValue(JSON.stringify({executable:false,blockedReasons:['timestamp_source_origin_invalid']}))
 expect(()=>new TimestampSchedulerService(config({...enabled,NODE_ENV:'production'})).onModuleInit()).toThrow('timestamp_production_preflight_failed')
 expect(spawn).not.toHaveBeenCalled()
})
it('uses the configured bounded heap and leaves safe worker diagnostics visible',()=>{
 const child=Object.assign(new EventEmitter(),{kill:jest.fn()});(spawn as jest.Mock).mockReturnValue(child)
 new TimestampSchedulerService(config({...enabled,WORKBENCH_TIMESTAMP_WORKER_HEAP_MB:'4096'})).onModuleInit()
 expect((spawn as jest.Mock).mock.calls[0][1][0]).toBe('--max-old-space-size=4096')
 expect((spawn as jest.Mock).mock.calls[0][2].stdio).toEqual(['ignore','inherit','inherit'])
})
