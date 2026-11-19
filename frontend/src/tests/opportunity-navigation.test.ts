import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'
import router from '@/router'
import Header from '@/components/layout/Header.vue'
import Sidebar from '@/components/layout/Sidebar.vue'
vi.mock('@/composables/useWorkbenchAccess', () => ({ refreshWorkbenchAccess: vi.fn(), useWorkbenchAccess: () => ({ access: { value: { isAdmin: false, businessRole: 'salesperson' } } }) }))
vi.mock('@/stores', () => ({ useUserStore: () => ({ user: { businessRole: 'salesperson' }, fetchUser: vi.fn(), displayName: '测试账号' }) }))
describe('opportunity navigation', () => {
 it.each([['/opportunities', 'Opportunities'], ['/opportunities/new', 'NewOpportunity'], ['/opportunities/o1', 'OpportunityDetail']])('registers authenticated %s without treating new as an id', (path, name) => { const route = router.resolve(path!); expect(route.name).toBe(name); expect(route.meta.requiresAuth).toBe(true) })
 it.each([['Opportunities', '商机管理'], ['NewOpportunity', '新增商机'], ['OpportunityDetail', '商机详情']])('displays the %s page title', async (name, title) => {
  const navigation = createRouter({ history: createMemoryHistory(), routes: [{ path: '/test', name, component: { template: '<div />' } }] }); await navigation.push('/test')
  const wrapper = mount(Header, { props: { sidebarCollapsed: false }, global: { plugins: [navigation, createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': { nav: { opportunities: '商机管理' } } } })], stubs: { DataDisplayScopeSwitch: true, LanguageSwitch: true, ThemeToggle: true } } })
  expect(wrapper.find('p').text()).toBe(title); wrapper.unmount()
 })
 it('places opportunity management immediately below customer leads', async () => {
  const navigation = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }] }); await navigation.push('/opportunities')
  const wrapper = mount(Sidebar, { props: { collapsed: false }, global: { plugins: [navigation, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })], stubs: { BrandLogo: true } } })
  const links = wrapper.findAll('nav a').map(item => item.attributes('href')); expect(links[links.indexOf('/leads') + 1]).toBe('/opportunities'); wrapper.unmount()
 })
})
