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
      workbenchRoles: ['sales'],
    } as unknown as User
    const repository = {
      findOne: jest.fn().mockResolvedValue(user),
      save: jest.fn(async (value) => value),
      update: jest.fn(async (_id, changes) => { Object.assign(user, changes) }),
    } as unknown as Repository<User>
    const service = new UsersService(repository)

    const result = await service.updateProfile('user-1', {
      username: 'sales-updated',
      role: UserRole.ADMIN,
      workbenchRoles: ['warehouse'],
    } as never)

    expect(result.username).toBe('sales-updated')
    expect(result.role).toBe(UserRole.USER)
    expect(result.workbenchRoles).toEqual(['sales'])
    expect(result.email).toBe('sales@autoflow.local')
    expect(repository.update).toHaveBeenCalledWith('user-1', { username: 'sales-updated' })
  })

  it.each(['profile', 'avatar'])('preserves a concurrent role revocation during an %s update', async (operation) => {
    const stored = {
      id: 'user-1', username: 'sales', avatarUrl: '/uploads/old.png',
      role: UserRole.ADMIN, workbenchRoles: ['sales'],
    }
    let firstRead = true
    const repository = {
      findOne: jest.fn(async () => {
        const snapshot = { ...stored, workbenchRoles: [...stored.workbenchRoles] }
        if (firstRead) {
          firstRead = false
          // An administrator revokes grants after the profile request read its entity.
          stored.role = UserRole.USER
          stored.workbenchRoles = []
        }
        return snapshot
      }),
      save: jest.fn(async (entity) => { Object.assign(stored, entity); return entity }),
      update: jest.fn(async (_id, changes) => { Object.assign(stored, changes) }),
    } as unknown as Repository<User>
    const service = new UsersService(repository)
    const result = operation === 'profile'
      ? await service.updateProfile('user-1', { username: 'sales-updated' })
      : await service.updateAvatar('user-1', '/uploads/new.png')

    expect(stored.workbenchRoles).toEqual([])
    expect(stored.role).toBe(UserRole.USER)
    expect(result.workbenchRoles).toEqual([])
    expect(result.role).toBe(UserRole.USER)
    expect(repository.update).toHaveBeenCalledWith('user-1', operation === 'profile'
      ? { username: 'sales-updated' }
      : { avatarUrl: '/uploads/new.png' })
    expect(repository.save).not.toHaveBeenCalled()
  })
})

describe('UsersService workbench persistence', () => {
  it('updates only business roles so simultaneous account identity changes cannot be overwritten', async () => {
    const stored = { id: 'user-1', username: 'current', role: UserRole.ADMIN, workbenchRoles: ['sales'] }
    const repository = {
      findOne: jest.fn().mockResolvedValue({ ...stored }),
      update: jest.fn(async (_id, changes) => { Object.assign(stored, changes) }),
      save: jest.fn(async (user) => user),
    } as unknown as Repository<User>
    const result = await new UsersService(repository).updateWorkbenchRoles('user-1', ['warehouse'])
    expect(repository.update).toHaveBeenCalledWith('user-1', { workbenchRoles: ['warehouse'] })
    expect(stored.role).toBe(UserRole.ADMIN)
    expect(result).not.toHaveProperty('password')
  })

  it('emits escaped literal search predicates and bounded pagination without selecting credentials', async () => {
    const repository = { findAndCount: jest.fn().mockResolvedValue([[], 0]) } as unknown as Repository<User>
    await new UsersService(repository).listWorkbenchAccounts({ page: 2, pageSize: 10, search: 'sales_%' })
    const options = (repository.findAndCount as jest.Mock).mock.calls[0][0]
    expect(options.skip).toBe(10)
    expect(options.take).toBe(10)
    expect(options.where).toHaveLength(3)
    expect(options.where[0].username.value).toBe('%sales\\_\\%%')
    expect(options.select).not.toHaveProperty('password')
  })
})
