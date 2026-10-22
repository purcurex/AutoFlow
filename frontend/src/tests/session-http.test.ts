import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import api from '@/api'
import { invalidateSession } from '@/utils/session'
import { useUserStore } from '@/stores/user'

beforeEach(() => { setActivePinia(createPinia()); localStorage.clear() })

describe('HTTP session boundaries', () => {
  it('rejects a previous account response before it reaches a view', async () => {
    let complete!: (value: AxiosResponse) => void
    let requestConfig!: InternalAxiosRequestConfig
    const request = api.get('/private', { adapter: config => {
      requestConfig = config
      return new Promise(done => { complete = done })
    } })
    const rejected = expect(request).rejects.toThrow(/session/i)
    invalidateSession()
    complete({ config: requestConfig, data: { private: 'A' }, status: 200, statusText: 'OK', headers: {} })
    await rejected
  })

  it('does not let an old unauthorized response log out the new account', async () => {
    let fail!: (error: unknown) => void
    let requestConfig!: InternalAxiosRequestConfig
    const request = api.get('/private', { adapter: config => {
      requestConfig = config
      return new Promise((_done, reject) => { fail = reject })
    } })
    const rejected = expect(request).rejects.toThrow(/session/i)
    invalidateSession()
    const user = { id: 'B', role: 'user', username: 'B' } as any
    useUserStore().user = user
    localStorage.setItem('user', JSON.stringify(user))
    fail(new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', requestConfig, undefined,
      { config: requestConfig, data: {}, status: 401, statusText: 'Unauthorized', headers: {} }))
    await rejected
    expect(useUserStore().user?.id).toBe('B')
    expect(JSON.parse(localStorage.getItem('user')!).id).toBe('B')
  })
})
