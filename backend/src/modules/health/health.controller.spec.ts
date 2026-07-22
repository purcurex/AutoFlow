import { ServiceUnavailableException } from '@nestjs/common'
import type { DataSource } from 'typeorm'
import { HealthController } from './health.controller'

describe('HealthController', () => {
  it('reports a live database', async () => {
    const dataSource = { query: jest.fn().mockResolvedValue([{ '?column?': 1 }]) } as unknown as DataSource
    const result = await new HealthController(dataSource).check()
    expect(result).toMatchObject({ status: 'ok', database: 'up' })
  })

  it('fails readiness when the database cannot be queried', async () => {
    const dataSource = { query: jest.fn().mockRejectedValue(new Error('offline')) } as unknown as DataSource
    await expect(new HealthController(dataSource).check()).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})
