import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { ExtendSourcingWindowDto } from './extend-sourcing-window.dto'

describe('ExtendSourcingWindowDto', () => {
  it.each([100, 200, 500])('accepts a 100-item target boundary: %i', async (targetLimit) => {
    const dto = plainToInstance(ExtendSourcingWindowDto, { targetLimit })

    await expect(validate(dto)).resolves.toHaveLength(0)
  })

  it.each([0, 99, 150, 200.5])('rejects a non-window target boundary: %s', async (targetLimit) => {
    const dto = plainToInstance(ExtendSourcingWindowDto, { targetLimit })

    await expect(validate(dto)).resolves.not.toHaveLength(0)
  })
})
