import { MODULE_METADATA } from '@nestjs/common/constants'
import { ConfigService } from '@nestjs/config'
import { ModuleRef } from '@nestjs/core'
import { UsersModule } from './users.module'
import { FOP_DATA_PROVIDER, FopDataProvider, UnconfiguredFopDataProvider } from '../fop-data/fop-data.types'
import { KingdeeFopDataProvider } from '../fop-data/fop-kingdee.provider'
import { DemoFopDataProvider } from '../fop-data/fop-demo.provider'

const provider = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, UsersModule) as { provide?: string | symbol; useFactory?: (modules: ModuleRef, config: ConfigService) => FopDataProvider }[])
  .find(entry => entry.provide === FOP_DATA_PROVIDER)!
const originalMode = process.env.FOP_DATA_MODE
const originalEnvironment = process.env.NODE_ENV

afterEach(() => {
  if (originalMode === undefined) delete process.env.FOP_DATA_MODE; else process.env.FOP_DATA_MODE = originalMode
  if (originalEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalEnvironment
  delete process.env.FOP_EMPLOYEE_API_URL
  delete process.env.FOP_EMPLOYEE_API_TOKEN
})

function select(mode?: string, environment = 'test') {
  if (mode === undefined) delete process.env.FOP_DATA_MODE; else process.env.FOP_DATA_MODE = mode
  process.env.NODE_ENV = environment
  process.env.FOP_EMPLOYEE_API_URL = 'https://unpublished.example.test/employee'
  process.env.FOP_EMPLOYEE_API_TOKEN = 'offline-test-only'
  const modules = { get: () => { throw new Error('Selecting a provider must not fetch users, workspaces or remote data') } } as unknown as ModuleRef
  return provider.useFactory!(modules, new ConfigService({ FOP_DATA_MODE: mode }))
}

it('selects Kingdee explicitly without falling back to another data source', () => {
  expect(select('kingdee')).toBeInstanceOf(KingdeeFopDataProvider)
})

it.each(['development', 'local', 'test'])('keeps explicit demo available in %s', environment => {
  expect(select('demo', environment)).toBeInstanceOf(DemoFopDataProvider)
})

it.each([undefined, 'http', 'live', 'unknown'])('keeps %s unconfigured despite obsolete employee gateway variables', mode => {
  const selected = select(mode)
  expect(selected).toBeInstanceOf(UnconfiguredFopDataProvider)
  expect(selected.isConfigured()).toBe(false)
})

it('keeps production unconfigured when demo is requested', () => {
  expect(select('demo', 'production')).toBeInstanceOf(UnconfiguredFopDataProvider)
})
