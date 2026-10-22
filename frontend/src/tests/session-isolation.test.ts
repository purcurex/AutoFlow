import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUserStore } from '@/stores/user'
import { useAutoFlowStore } from '@/stores/autoflow'
import { useNoteStore } from '@/stores/note'
import { autoflowApi } from '@/api/autoflow'
import { notesApi } from '@/api/notes'
import { authApi } from '@/api/auth'
import { getWorkbenchAccess } from '@/api/workbench-access'
import { refreshWorkbenchAccess, useWorkbenchAccess } from '@/composables/useWorkbenchAccess'

vi.mock('@/api/autoflow', () => ({ autoflowApi: { getWorkflows: vi.fn() } }))
vi.mock('@/api/notes', () => ({ notesApi: { getAll: vi.fn() } }))
vi.mock('@/api/auth', () => ({ authApi: { login: vi.fn(), logout: vi.fn(), getProfile: vi.fn() } }))
vi.mock('@/api/workbench-access', () => ({ getWorkbenchAccess: vi.fn() }))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const userB = { id: 'user-b', username: 'B', email: 'b@example.test', role: 'user' } as any

beforeEach(() => { setActivePinia(createPinia()); localStorage.clear(); vi.clearAllMocks() })

describe('account session isolation', () => {
  it('clears business state immediately, before logout completes', async () => {
    const users = useUserStore(), flow = useAutoFlowStore(), notes = useNoteStore()
    flow.workflows = [{ id: 'private-a' }] as any
    notes.notes = [{ id: 'private-note-a' }] as any
    notes.searchQuery = 'private search'
    const logout = deferred<{ success: boolean }>()
    vi.mocked(authApi.logout).mockReturnValue(logout.promise)
    users.logout()
    expect(flow.workflows).toEqual([])
    expect(notes.notes).toEqual([])
    expect(notes.searchQuery).toBe('')
    logout.resolve({ success: true })
    await logout.promise
  })

  it('rejects old business responses after switching accounts', async () => {
    const users = useUserStore(), flow = useAutoFlowStore(), notes = useNoteStore()
    const oldFlow = deferred<any>(), oldNotes = deferred<any>()
    vi.mocked(autoflowApi.getWorkflows).mockReturnValue(oldFlow.promise)
    vi.mocked(notesApi.getAll).mockReturnValue(oldNotes.promise)
    const flowRequest = flow.fetchWorkflows(), notesRequest = notes.fetchNotes()
    const flowRejected = expect(flowRequest).rejects.toThrow(/session/i)
    const notesRejected = expect(notesRequest).rejects.toThrow(/session/i)
    vi.mocked(authApi.login).mockResolvedValue({ user: userB } as any)
    await users.login('b@example.test', 'password')
    oldFlow.resolve({ items: [{ id: 'private-a' }] })
    oldNotes.resolve([{ id: 'private-note-a' }])
    await Promise.all([flowRejected, notesRejected])
    expect(flow.workflows).toEqual([])
    expect(notes.notes).toEqual([])
    expect(users.user?.id).toBe('user-b')
  })

  it('cannot repopulate workbench permissions after clearing the session', async () => {
    const request = deferred<any>()
    vi.mocked(getWorkbenchAccess).mockReturnValue(request.promise)
    const refresh = refreshWorkbenchAccess()
    const rejected = expect(refresh).rejects.toThrow(/session|superseded/i)
    useUserStore().clearSession()
    request.resolve({ roles: ['sales'], isAdmin: true })
    await rejected
    expect(useWorkbenchAccess().access.value).toBeUndefined()
  })

  it('does not let an old profile request overwrite the new account', async () => {
    const users = useUserStore(), oldProfile = deferred<any>()
    localStorage.setItem('user', JSON.stringify({ id: 'user-a' }))
    vi.mocked(authApi.getProfile).mockReturnValue(oldProfile.promise)
    const profileRequest = users.fetchUser()
    vi.mocked(authApi.login).mockResolvedValue({ user: userB } as any)
    await users.login('b@example.test', 'password')
    oldProfile.resolve({ id: 'user-a', username: 'A' })
    await profileRequest
    expect(users.user?.id).toBe('user-b')
    expect(JSON.parse(localStorage.getItem('user')!).id).toBe('user-b')
  })

  it('clears cached data when a different tab switches the cookie account', () => {
    const flow = useAutoFlowStore()
    flow.workflows = [{ id: 'private-a' }] as any
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'user', oldValue: JSON.stringify({ id: 'A' }), newValue: JSON.stringify({ id: 'B' }),
    }))
    expect(flow.workflows).toEqual([])
  })

  it('serializes cookie changes so a slow old login cannot replace a newer login', async () => {
    const users = useUserStore(), first = deferred<any>()
    vi.mocked(authApi.login).mockReturnValueOnce(first.promise).mockResolvedValueOnce({ user: userB } as any)
    const loginA = users.login('a@example.test', 'password')
    const rejected = expect(loginA).rejects.toThrow(/session/i)
    await Promise.resolve()
    const loginB = users.login('b@example.test', 'password')
    await Promise.resolve()
    expect(authApi.login).toHaveBeenCalledTimes(1)
    first.resolve({ user: { id: 'A' } })
    await rejected
    await loginB
    expect(authApi.login).toHaveBeenCalledTimes(2)
    expect(users.user?.id).toBe('user-b')
  })
})
