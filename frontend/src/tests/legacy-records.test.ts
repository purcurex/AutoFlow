import { createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ExportDialog from '@/components/export/ExportDialog.vue'
import Sidebar from '@/components/layout/Sidebar.vue'
import router from '@/router'

describe('legacy business record compatibility', () => {
  it('keeps the legacy detail route out of primary navigation', async () => {
    await router.push('/')
    await router.isReady()

    const wrapper = mount(Sidebar, {
      props: { collapsed: false },
      global: { plugins: [createPinia(), router] },
    })

    const route = router.getRoutes().find((item) => item.name === 'NoteDetail')

    expect(route?.meta.legacySupport).toBe(true)
    expect(wrapper.find('a[href^="/notes/"]').exists()).toBe(false)
  })

  it('uses business record terminology in the export dialog', () => {
    const wrapper = mount(ExportDialog, {
      props: { visible: true, notes: [] },
      global: {
        plugins: [createPinia()],
        stubs: { Teleport: true },
      },
    })

    expect(wrapper.text()).toContain('导出业务记录')
    expect(wrapper.text()).not.toContain('笔记')
  })
})
