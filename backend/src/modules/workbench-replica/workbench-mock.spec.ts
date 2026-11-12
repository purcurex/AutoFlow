import { ConfigService } from '@nestjs/config'
import { workbenchMockEnabled } from './workbench-mock'

describe('schema-backed mock environment isolation', () => {
  const valid = { NODE_ENV: 'test', WORKBENCH_READ_MODE: 'local', WORKBENCH_MOCK_ENABLED: 'true', DB_HOST: '127.0.0.1', DB_DATABASE: 'autoflow_workbench_mock' }
  it('requires an explicit flag and the dedicated loopback mock database', () => {
    expect(workbenchMockEnabled(new ConfigService({}))).toBe(false)
    expect(workbenchMockEnabled(new ConfigService(valid))).toBe(true)
    for (const change of [{ NODE_ENV: 'production' }, { DB_DATABASE: 'autoflow_local_demo' }, { DB_HOST: 'cloud.example' }, { WORKBENCH_READ_MODE: 'live' }]) {
      expect(() => workbenchMockEnabled(new ConfigService({ ...valid, ...change }))).toThrow()
    }
  })
})
