import { beforeEach, describe, expect, it, vi } from 'vitest'
import router from '@/router'

vi.mock('@/api/workbench-access', () => ({ getWorkbenchAccess: vi.fn().mockResolvedValue({ roles: ['sales', 'procurement', 'allocation', 'dispatch', 'warehouse'], isAdmin: false }) }))

describe('security and compatibility routing', () => {
  beforeEach(async () => {
    localStorage.clear()
    await router.push('/login')
  })

  it('redirects the legacy CRM route to lightweight follow-up', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'user' }))

    await router.push('/crm')

    expect(router.currentRoute.value.name).toBe('FollowUps')
  })

  it('exposes AI prompt templates as an authenticated top-level route', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'user' }))

    await router.push('/prompt-templates')

    expect(router.currentRoute.value.name).toBe('PromptTemplates')
  })
})
