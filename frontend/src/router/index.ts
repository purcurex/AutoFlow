import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { isFopOrderQueue } from '@/api/fop-orders'
import { isWorkbenchRole, workbenchOrderLocation } from '@/utils/workbench'
import { refreshWorkbenchAccess } from '@/composables/useWorkbenchAccess'

const routes: RouteRecordRaw[] = [
  {
    path: '/organization', name: 'Organization',
    component: () => import('@/views/OrganizationView.vue'), meta: { requiresAuth: true },
  },
  {
    path: '/admin/workbenches', name: 'WorkbenchRoleAdmin',
    component: () => import('@/views/WorkbenchRoleAdminView.vue'), meta: { requiresAuth: true },
  },
  {
    path: '/workbench-access-denied', name: 'WorkbenchAccessDenied',
    component: () => import('@/views/WorkbenchAccessDenied.vue'), meta: { requiresAuth: true },
  },
  {
    path: '/dashboard/orders',
    name: 'FopOrders',
    redirect: route => isFopOrderQueue(route.query.queue)
      ? workbenchOrderLocation(route.query.queue, route.query)
      : { name: 'RoleWorkbench', params: { role: 'sales' }, query: route.query },
  },
  {
    path: '/workbench/:role',
    name: 'RoleWorkbench',
    component: () => import('@/views/autoflow/WorkbenchView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/dashboard',
    name: 'FopDashboard',
    component: () => import('@/views/autoflow/FopDashboardView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/',
    name: 'Dashboard',
    component: () => import('@/views/autoflow/WorkbenchView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/workflows',
    name: 'Workflows',
    component: () => import('@/views/autoflow/WorkflowsView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/workflows/new',
    name: 'NewWorkflow',
    component: () => import('@/views/autoflow/WorkflowsView.vue'),
    props: { create: true },
    meta: { requiresAuth: true }
  },
  {
    path: '/workflows/:id/revise',
    name: 'ReviseWorkflow',
    component: () => import('@/views/autoflow/WorkflowsView.vue'),
    props: (route) => ({ create: true, reviseId: String(route.params.id) }),
    meta: { requiresAuth: true }
  },
  {
    path: '/workflows/:id/sourcing',
    name: 'WorkflowSourcing',
    component: () => import('@/views/autoflow/SourcingView.vue'),
    props: true,
    meta: { requiresAuth: true }
  },
  {
    path: '/leads',
    name: 'Leads',
    component: () => import('@/views/autoflow/LeadsView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/leads/:id',
    name: 'LeadDetail',
    component: () => import('@/views/autoflow/LeadDetailView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/outreach',
    name: 'Outreach',
    component: () => import('@/views/autoflow/OutreachView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/quotes',
    name: 'Quotes',
    component: () => import('@/views/autoflow/QuoteView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/follow-ups',
    name: 'FollowUps',
    component: () => import('@/views/autoflow/FollowUpView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/crm',
    redirect: { name: 'FollowUps' }
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/LoginView.vue'),
    meta: { guest: true }
  },
  {
    path: '/register',
    name: 'Register',
    component: () => import('@/views/RegisterView.vue'),
    meta: { guest: true }
  },
  {
    path: '/notes/:id',
    name: 'NoteDetail',
    component: () => import('@/views/NoteDetailView.vue'),
    meta: { requiresAuth: true, legacySupport: true }
  },
  {
    path: '/prompt-templates',
    name: 'PromptTemplates',
    component: () => import('@/views/PromptTemplatesView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('@/views/SettingsView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/admin',
    name: 'Admin',
    component: () => import('@/views/AdminView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true }
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/views/NotFoundView.vue')
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach(async (to, _from, next) => {
  const hasSession = Boolean(localStorage.getItem('user'))
  if (to.meta.requiresAuth && !hasSession) return next({ name: 'Login', query: { redirect: to.fullPath } })
  if (to.meta.guest && hasSession) return next({ name: 'Dashboard' })
  if (!to.meta.requiresAuth) return next()
  if (to.name === 'WorkbenchAccessDenied') return next()
  try {
    const access = await refreshWorkbenchAccess()
    if (['WorkbenchRoleAdmin', 'Organization'].includes(String(to.name))) { if (access.isAdmin) return next(); return next({ name: 'WorkbenchAccessDenied' }) }
    const managementPage = ['Organization', 'Settings'].includes(String(to.name))
    if (access.businessRole === 'none' && !managementPage) {
      return next({ name: access.isAdmin ? 'WorkbenchRoleAdmin' : 'WorkbenchAccessDenied' })
    }
    if (to.meta.requiresAdmin && (!access.isAdmin || access.businessRole !== 'admin')) return next({ name: 'Dashboard' })
    if (['Dashboard', 'RoleWorkbench'].includes(String(to.name))) {
      const requested = to.name === 'Dashboard' ? (access.roles.includes('sales') ? 'sales' : access.roles[0]) : to.params.role
      if (!isWorkbenchRole(requested) || !access.roles.includes(requested)) return next({ name: 'WorkbenchAccessDenied' })
      if (to.name === 'Dashboard' && requested !== 'sales') return next({ name: 'RoleWorkbench', params: { role: requested } })
    }
    next()
  } catch {
    next({ name: 'WorkbenchAccessDenied' })
  }
})

export default router
