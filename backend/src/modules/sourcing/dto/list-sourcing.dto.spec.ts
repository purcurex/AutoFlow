import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { ListSourcingDto } from './list-sourcing.dto'

describe('ListSourcingDto', () => {
  it('transforms valid pagination query values', async () => {
    const dto = plainToInstance(ListSourcingDto, {
      searchId: '11111111-1111-4111-8111-111111111111',
      page: '2',
      pageSize: '50',
    })

    await expect(validate(dto)).resolves.toHaveLength(0)
    expect(dto).toMatchObject({ page: 2, pageSize: 50 })
  })

  it('rejects unsupported page sizes and non-positive pages', async () => {
    const dto = plainToInstance(ListSourcingDto, { page: 0, pageSize: 25 })

    expect((await validate(dto)).map((error) => error.property)).toEqual(
      expect.arrayContaining(['page', 'pageSize']),
    )
  })
})
