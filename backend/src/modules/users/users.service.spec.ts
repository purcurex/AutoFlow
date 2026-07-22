import type { Repository } from 'typeorm'
import { User, UserRole } from './user.entity'
import { UsersService } from './users.service'

describe('UsersService profile updates', () => {
  it('updates only profile fields even when an unsafe runtime property is supplied', async () => {
    const user = {
      id: 'user-1',
      email: 'sales@autoflow.local',
      username: 'sales',
      avatarUrl: null,
      password: 'hash',
      role: UserRole.USER,
    } as unknown as User
    const repository = {
      findOne: jest.fn().mockResolvedValue(user),
      save: jest.fn(async (value) => value),
    } as unknown as Repository<User>
    const service = new UsersService(repository)

    const result = await service.updateProfile('user-1', {
      username: 'sales-updated',
      role: UserRole.ADMIN,
    } as never)

    expect(result.username).toBe('sales-updated')
    expect(result.role).toBe(UserRole.USER)
    expect(result.email).toBe('sales@autoflow.local')
  })
})
