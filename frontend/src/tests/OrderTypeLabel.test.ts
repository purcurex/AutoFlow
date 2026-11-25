import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { expect, it } from 'vitest'
import OrderTypeLabel from '@/components/autoflow/OrderTypeLabel.vue'
const render = (props: {code?: string | null; name?: string | null}, locale='zh-CN') => mount(OrderTypeLabel, {props, global:{plugins:[createI18n({legacy:false,locale,messages:{}})]}})
it('shows the authoritative sample type with the shared info badge',()=>{
 const wrapper=render({code:'hzkj_orders_BT_Sample'})
 expect(wrapper.text()).toBe('样品订单')
 expect(wrapper.find('[data-tone="info"]').exists()).toBe(true)
 expect(render({code:'hzkj_orders_BT_Sample'},'en').text()).toBe('Sample order')
})
it('accepts explicit source name only when no type code is present',()=>{
 expect(render({name:'样品订单'}).text()).toBe('样品订单')
 for(const props of [{},{code:'hzkj_orders_BT'},{code:'future',name:'样品订单'},{name:'履约订单'}]) expect(render(props).find('.order-type-label').exists()).toBe(false)
})
