import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { StartSourcingDto } from './start-sourcing.dto'

describe('StartSourcingDto', () => {
  it('accepts optional sourcing filters', async () => {
    const dto = plainToInstance(StartSourcingDto, {
      force: true,
      priceMin: 1.5,
      priceMax: 20,
      pageSize: 20,
    })

    await expect(validate(dto)).resolves.toHaveLength(0)
  })

  it('rejects invalid price and page limits', async () => {
    const dto = plainToInstance(StartSourcingDto, {
      priceMin: -1,
      pageSize: 100,
    })

    expect(await validate(dto)).toHaveLength(2)
  })
})
