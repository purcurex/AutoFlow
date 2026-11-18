import {collectedOrderMoney} from './collected-order-money'
it('uses the order field, retains zero, and applies the confirmed USD currency',()=>{
 const old={amount:null,currency:null,amountBreakdown:{taxAmount:null},dataQuality:{missingFields:['amount','currency','taxAmount']}}
 expect(collectedOrderMoney(old,{hzkj_order_amount:'12.30',hzkj_total_amount:'15.64'},'100000')).toMatchObject({amount:15.64,currency:'USD',amountBreakdown:{totalAmount:15.64,taxAmount:null},dataQuality:{missingFields:['taxAmount']}})
 expect(collectedOrderMoney(old,{hzkj_total_amount:'0'},'100000').amount).toBe(0)
 expect(old.amount).toBeNull()
})
it('preserves explicit currencies, leaves absent amounts and unsafe decimals unknown',()=>{
 expect(collectedOrderMoney({}, {hzkj_total_amount:null,hzkj_settlecurrency:{number:'EUR'}},'100000')).toMatchObject({amount:null,currency:'EUR'})
 expect(collectedOrderMoney({}, {hzkj_total_amount:'9007199254740993.01'},'other')).toMatchObject({amount:null,currency:'USD'})
})

it('keeps native platform-order components independently of a receipt and does not turn product into total',()=>{
 expect(collectedOrderMoney({}, {hzkj_order_amount:'10.9'},'100000')).toMatchObject({amount:null,amountBreakdown:{productAmount:10.9,shippingFee:null,taxAmount:null}})
 expect(collectedOrderMoney({}, {hzkj_total_amount:'15',hzkj_order_amount:'10',hzkj_fre_quo_amount:'4',hzkj_fixed_tax_fee:'99',hzkj_logistics_info:[{id:'p1',hzkj_package_tax_fee:'1'}],hzkj_discount_cost:'0'},'100000')).toMatchObject({amount:15,amountBreakdown:{productAmount:10,shippingFee:4,taxAmount:99,discountAmount:0}})
})

it('reads verified same-order supplements including explicit null without mutating the original raw',()=>{
 const raw={id:'1',billno:'TO1',hzkj_order_amount:'2'},capture={sourceId:'1',orderNumber:'TO1',companyId:'100000',operation:'order-detail',values:{hzkj_total_amount:'5',hzkj_order_amount:'3',hzkj_fre_quo_amount:'2'}}
 expect(collectedOrderMoney({moneyCapture:capture},raw,'100000')).toMatchObject({amount:5,amountBreakdown:{productAmount:3,shippingFee:2}})
 expect(collectedOrderMoney({moneyCapture:{...capture,sourceId:'other'}},raw,'100000').amount).toBeNull()
 expect(raw.hzkj_order_amount).toBe('2')
})

it('uses fixed header tax regardless of absent, duplicate or conflicting package tax',()=>{
 const display={amount:999,amountBreakdown:{taxAmount:99}}
 for(const rows of [undefined,[],[{hzkj_package_tax_fee:null}],[{id:'1',hzkj_package_tax_fee:'1'},{id:'1',hzkj_package_tax_fee:'1'}],[{hzkj_package_tax_fee:'1'},{}]])expect(collectedOrderMoney(display,{hzkj_fixed_tax_fee:'5.75',hzkj_logistics_info:rows},'100000').amountBreakdown.taxAmount).toBe(5.75)
 expect(collectedOrderMoney(display,{hzkj_fixed_tax_fee:'0',hzkj_logistics_info:[{hzkj_package_tax_fee:'99'}]},'100000')).toMatchObject({amount:null,currency:'USD',amountBreakdown:{taxAmount:0}})
 for(const value of [undefined,null,'',false,'invalid','9007199254740993.01'])expect(collectedOrderMoney(display,{hzkj_fixed_tax_fee:value,hzkj_logistics_info:[{hzkj_package_tax_fee:'1'}]},'100000').amountBreakdown.taxAmount).toBeNull()
})

it('uses a verified fixed-tax supplement only when the current header omitted that field',()=>{
 const capture={sourceId:'1',orderNumber:'TO1',companyId:'100000',operation:'order-list',values:{hzkj_total_amount:'24.54',hzkj_order_amount:'12.93',hzkj_fre_quo_amount:'5.86',hzkj_fixed_tax_fee:'5.75',hzkj_logistics_info:[{hzkj_combofield:'1'}]}}
 expect(collectedOrderMoney({moneyCapture:capture},{id:'1',billno:'TO1'},'100000')).toMatchObject({amount:24.54,currency:'USD',amountBreakdown:{productAmount:12.93,shippingFee:5.86,taxAmount:5.75}})
 for(const value of [null,'0','11.50'])expect(collectedOrderMoney({moneyCapture:capture},{id:'1',billno:'TO1',hzkj_fixed_tax_fee:value},'100000').amountBreakdown.taxAmount).toBe(value===null?null:Number(value))
 for(const patch of [{sourceId:'2'},{orderNumber:'TO2'},{companyId:'200000'}])expect(collectedOrderMoney({moneyCapture:{...capture,...patch}},{id:'1',billno:'TO1'},'100000').amountBreakdown.taxAmount).toBeNull()
})
