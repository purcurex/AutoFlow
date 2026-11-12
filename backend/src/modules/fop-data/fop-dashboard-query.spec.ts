import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { FopDashboardQueryDto } from './fop-data.dto'
it('parses analytics-only dashboard mode without truthy-string coercion', async () => {
  const query = { from: '2026-11-01', to: '2026-11-10', year: '2026', includeQueues: 'false' }
  const dto = plainToInstance(FopDashboardQueryDto, query)
  expect(dto.includeQueues).toBe(false)
  expect(await validate(dto)).toHaveLength(0)
  expect(await validate(plainToInstance(FopDashboardQueryDto, { ...query, includeQueues: 'anything' }))).not.toHaveLength(0)
})
