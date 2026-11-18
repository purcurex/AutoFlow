import { expect, it } from 'vitest'
import {businessStatusLabel} from '@/utils/fulfillment-source-status'
it.each([['fulfilled','已发货'],['partial','部分发货'],['pending','待处理'],['','待确认'],[undefined,'待确认'],['unknown','待确认'],['  ','待确认'],['新状态','新状态'],['not_required','not_required']])('renders native source shipment %s without order-state inference',(value,label)=>expect(businessStatusLabel(value,'source')).toBe(label))
