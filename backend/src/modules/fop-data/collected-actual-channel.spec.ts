import { withCollectedOrderLogistics } from './collected-actual-channel'
import { withCollectedActualChannel } from './collected-actual-channel'

const raw = { hzkj_logistics_channel: { name: '云途德国专线', number: 'YT-DE' } }
it('shows the actual channel before a shipment exists without inventing tracking', () => {
  expect(withCollectedActualChannel({ logisticsInfo: null }, raw).logisticsInfo).toEqual([
    { channelName: '云途德国专线', channelCode: 'YT-DE', trackingNumbers: [] },
  ])
})
it('preserves a shipment channel and never pairs a conflicting code with the order name', () => {
  for (const group of [{ channelName: '发运渠道', channelCode: 'OTHER' }, { channelName: null, channelCode: 'OTHER' }]) {
    expect(withCollectedActualChannel({ logisticsInfo: [group] }, raw).logisticsInfo).toEqual([group])
  }
})
it('does not borrow custom channel/provider names or stale order names after an explicit clear', () => {
  const display = { logisticsChannels: [{ name: '旧渠道', code: 'OLD' }], logisticsInfo: [{ channelName: null, trackingNumbers: [] }] }
  const result = withCollectedActualChannel(display, { hzkj_logistics_channel: null, hzkj_customer_channel: { name: 'Standard' }, hzkj_logistics_providers: { name: '云途' } })
  expect(result.logisticsChannels).toBeNull()
  expect(result.logisticsInfo[0].channelName).toBeNull()
  expect(display.logisticsChannels[0].name).toBe('旧渠道')
})

it('uses package actual channels before the legacy header without borrowing the provider or custom channel', () => {
  const result=withCollectedActualChannel({logisticsInfo:null},{...raw,hzkj_customer_channel:{name:'HZpacket Standard Electronics'},hzkj_logistics_info:[
    {hzkj_combofield:'1',hzkj_channel:{name:{zh_CN:'万邦快线含电',en_US:'Wanb Express'},number:'WB',hzkj_logistics_providers:{name:'万邦'}}},
    {hzkj_combofield:'2',hzkj_channel:{name:'云途标准专线',number:'YT'}},
  ]})
  expect(result.logisticsChannels).toEqual([{name:'万邦快线含电',code:'WB'},{name:'云途标准专线',code:'YT'}])
})
it('keeps explicitly cleared package channels blank instead of restoring the header', () => {
  expect(withCollectedActualChannel({logisticsChannels:[{name:'旧渠道'}]}, {...raw,hzkj_logistics_info:[{hzkj_channel:null}]}).logisticsChannels).toBeNull()
})
it('does not assign package channels to unrelated dispatch groups by position', () => {
  const groups=[{channelName:null,trackingNumbers:[{type:'full',number:'001'}]}]
  const result=withCollectedActualChannel({logisticsInfo:groups},{hzkj_logistics_info:[
    {hzkj_channel:{name:'渠道甲',number:'A'}},{hzkj_channel:{name:'渠道乙',number:'B'}},
  ]})
  expect(result.logisticsInfo.map((g:any)=>[g.channelName,g.packageTrackingNumber])).toEqual([['渠道甲',null],['渠道乙',null]])
  expect(JSON.stringify(result.logisticsInfo)).not.toContain('001')
})
it('does not fall back to English when a package name has no Chinese translation', () => {
  const result=withCollectedActualChannel({}, {hzkj_logistics_info:[{hzkj_channel:{name:{en_US:'Express'},number:'WB'}}]})
  expect(result.logisticsChannels).toEqual([{name:null,code:'WB'}])
})
it('reads the actual queryOrderList channel alias rather than expecting only nested base data',()=>{
 expect(withCollectedActualChannel({}, {hzkj_logistics_info:[{hzkj_combofield:'1',hzkj_channel_name:'万邦快线含电'}]}).logisticsChannels).toEqual([{name:'万邦快线含电',code:null}])
})
it('uses a matching local capture and rejects cross-company or cross-order channel supplements',()=>{
 const source={id:'1',billno:'TO1'}
 const capture={sourceId:'1',orderNumber:'TO1',companyId:'100000',operation:'order-list',values:{hzkj_logistics_info:[{hzkj_channel_name:'万邦快线含电'}]}}
 expect(withCollectedActualChannel({moneyCapture:capture},source,'100000').logisticsChannels).toEqual([{name:'万邦快线含电',code:null}])
 for(const patch of [{companyId:'other'},{sourceId:'2'},{orderNumber:'TO2'},{operation:'unknown'}]){
  expect(withCollectedActualChannel({moneyCapture:{...capture,...patch}},source,'100000').logisticsChannels).toBeUndefined()
 }
})
it('keeps actual channels and tracking paired by their own fulfillment package',()=>{
 const result=withCollectedActualChannel({logisticsInfo:[{channelName:'旧发运',trackingNumbers:[{type:'full',number:'OLD'}]}]}, {hzkj_logistics_info:[
  {hzkj_combofield:'1',hzkj_channel_name:'渠道甲',hzkj_tracking_number:'000A'},
  {hzkj_combofield:'2',hzkj_channel_name:'渠道乙',hzkj_tracking_number:'000B'},
 ]})
 expect(result.logisticsInfo.map((g:any)=>[g.channelName,g.packageTrackingNumber])).toEqual([['渠道甲','000A'],['渠道乙','000B']])
 expect(JSON.stringify(result.logisticsInfo)).not.toContain('OLD')
 expect(result.trackingNumber).toBeNull()
 expect(withCollectedActualChannel({trackingNumber:'OLD'}, {hzkj_logistics_info:[{hzkj_tracking_number:'000A'}]}).trackingNumber).toBe('000A')
})

describe('pending dispatch source isolation',()=>{
 const raw={hzkj_logistics_info:[{hzkj_channel_name:'包裹渠道',hzkj_tracking_number:'PACKAGE'}]}
 it('never substitutes package or last-mile tracking for a missing dispatch header',()=>{
  const display={dispatchDocuments:[{channelName:'发运渠道',trackingNumbers:[{type:'last_mile',number:'TAIL'}]}]}
  const result=withCollectedOrderLogistics(display,raw,undefined,{queue:'dispatch'})
  expect(result.logisticsInfo).toEqual([{channelName:'发运渠道',channelCode:null,trackingNumbers:[]}])
  expect(result.trackingNumber).toBeNull()
 })
 it('keeps multiple dispatch channels paired and leaves a single-number summary empty',()=>{
  const display={dispatchDocuments:[1,2].map(n=>({channelName:'渠道'+n,trackingNumbers:[{type:'full',number:'00'+n}]}))}
  const result=withCollectedOrderLogistics(display,raw,undefined,{queue:'dispatch'})
  expect(result.logisticsInfo.map((g:any)=>[g.channelName,g.trackingNumbers[0].number])).toEqual([['渠道1','001'],['渠道2','002']])
  expect(result.trackingNumber).toBeNull()
 })
 it.each([{queue:'dispatch',completed:true},{queue:'review',completed:true}])('completed views retain package tracking %j',query=>{
  expect(withCollectedOrderLogistics({dispatchDocuments:[{trackingNumbers:[{type:'full',number:'DISPATCH'}]}]},raw,undefined,query).logisticsInfo[0].packageTrackingNumber).toBe('PACKAGE')
 })
})
it('never overwrites current package facts, including an explicit empty array, with an older supplement',()=>{
 const capture={sourceId:'1',orderNumber:'TO1',companyId:'100000',operation:'order-list',values:{hzkj_logistics_info:[{hzkj_tracking_number:'OLD',hzkj_channel_name:'旧渠道'}]}}
 const display={moneyCapture:capture}
 const raw={id:'1',billno:'TO1',hzkj_logistics_info:[{hzkj_tracking_number:'NEW',hzkj_channel_name:'新渠道'}]}
 expect(withCollectedActualChannel(display,raw,'100000').trackingNumber).toBe('NEW')
 expect(withCollectedActualChannel(display,{...raw,hzkj_logistics_info:[]},'100000').logisticsInfo??[]).toEqual([])
 expect(withCollectedActualChannel(display,{...raw,hzkj_logistics_info:null},'100000').trackingNumber??null).toBeNull()
})
