import { UserRole } from '../users/user.entity'
import type { UsersService } from '../users/users.service'
import { SeederService } from './seeder.service'
import { ConfigService } from '@nestjs/config'

describe('SeederService', () => {
  function createUsersService() {
    return {
      findByEmail: jest.fn(),
      findByUsername: jest.fn(),
      create: jest.fn(),
    } as unknown as jest.Mocked<UsersService>
  }

  function createConfigService(enabled = true) {
    return new ConfigService({
      ENABLE_ADMIN_BOOTSTRAP: enabled ? 'true' : 'false',
      ADMIN_BOOTSTRAP_EMAIL: 'bootstrap@autoflow.local',
      ADMIN_BOOTSTRAP_PASSWORD: 'StrongBootstrapPassword',
    })
  }

  it('does not query users when admin bootstrap is disabled', async () => {
    const usersService = createUsersService()

    await new SeederService(usersService, createConfigService(false)).seedAdmin()

    expect(usersService.findByEmail).not.toHaveBeenCalled()
    expect(usersService.create).not.toHaveBeenCalled()
  })

  it('does not create a duplicate when the admin email exists', async () => {
    const usersService = createUsersService()
    usersService.findByEmail.mockResolvedValue({ id: 'existing' } as never)
    usersService.findByUsername.mockResolvedValue(null)

    await new SeederService(usersService, createConfigService()).seedAdmin()

    expect(usersService.create).not.toHaveBeenCalled()
  })

  it('does not create a duplicate when the admin username exists', async () => {
    const usersService = createUsersService()
    usersService.findByEmail.mockResolvedValue(null)
    usersService.findByUsername.mockResolvedValue({ id: 'existing' } as never)

    await new SeederService(usersService, createConfigService()).seedAdmin()

    expect(usersService.create).not.toHaveBeenCalled()
  })

  it('creates the default admin only when both identifiers are available', async () => {
    const usersService = createUsersService()
    usersService.findByEmail.mockResolvedValue(null)
    usersService.findByUsername.mockResolvedValue(null)

    await new SeederService(usersService, createConfigService()).seedAdmin()

    expect(usersService.create).toHaveBeenCalledWith(
      'bootstrap@autoflow.local',
      'Admin',
      'StrongBootstrapPassword',
      UserRole.ADMIN,
      '000001',
    )
  })
})
