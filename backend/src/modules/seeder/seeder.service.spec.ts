import { UserRole } from '../users/user.entity'
import type { UsersService } from '../users/users.service'
import { SeederService } from './seeder.service'

describe('SeederService', () => {
  function createUsersService() {
    return {
      findByEmail: jest.fn(),
      findByUsername: jest.fn(),
      create: jest.fn(),
    } as unknown as jest.Mocked<UsersService>
  }

  it('does not create a duplicate when the admin email exists', async () => {
    const usersService = createUsersService()
    usersService.findByEmail.mockResolvedValue({ id: 'existing' } as never)
    usersService.findByUsername.mockResolvedValue(null)

    await new SeederService(usersService).seedAdmin()

    expect(usersService.create).not.toHaveBeenCalled()
  })

  it('does not create a duplicate when the admin username exists', async () => {
    const usersService = createUsersService()
    usersService.findByEmail.mockResolvedValue(null)
    usersService.findByUsername.mockResolvedValue({ id: 'existing' } as never)

    await new SeederService(usersService).seedAdmin()

    expect(usersService.create).not.toHaveBeenCalled()
  })

  it('creates the default admin only when both identifiers are available', async () => {
    const usersService = createUsersService()
    usersService.findByEmail.mockResolvedValue(null)
    usersService.findByUsername.mockResolvedValue(null)

    await new SeederService(usersService).seedAdmin()

    expect(usersService.create).toHaveBeenCalledWith(
      'admin@autoflow.local',
      'admin',
      'Admin@123456',
      UserRole.ADMIN,
    )
  })
})
