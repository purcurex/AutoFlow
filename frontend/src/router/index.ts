import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Dashboard',
    component: () => import('@/views/autoflow/DashboardView.vue'),
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
    path: '/crm',
    name: 'CRM',
    component: () => import('@/views/autoflow/CrmView.vue'),
    meta: { requiresAuth: true }
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
  const token = localStorage.getItem('token')

  if (to.meta.requiresAuth && !token) {
    next({ name: 'Login', query: { redirect: to.fullPath } })
  } else if (to.meta.guest && token) {
    next({ name: 'Dashboard' })
  } else if (to.meta.requiresAdmin) {
    const userStr = localStorage.getItem('user')
    if (userStr) {
      const user = JSON.parse(userStr)
      if (user.role !== 'admin') {
        next({ name: 'Dashboard' })
        return
      }
    }
    next()
  } else {
    next()
  }
})

export default router

