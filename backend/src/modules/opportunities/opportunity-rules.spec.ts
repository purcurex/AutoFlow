import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common'
import { validateFields, validateFollowUp, applyFollowUp, assertVersion, canWrite, opportunityOptions, exportWorkbook, validateQuery } from './opportunity-rules'
import { Workbook } from 'exceljs'

describe('local opportunity boundaries', () => {
  it('accepts a customer-only draft without inventing amount', () => {
    expect(validateFields({customerName:' 客户 '}, true)).toEqual({customerName:'客户'})
    expect(validateFields({monthlyAmount:null})).toEqual({monthlyAmount:null})
  })
  it.each(['0', '1234567890123456.78', '001.20'])('preserves exact amount %s', value => {
    expect(validateFields({monthlyAmount:value}).monthlyAmount).toBe(value)
  })
  it.each([-1, 1.2, '-1', '1.001', '1e3', 'NaN', '12345678901234567.00'])('rejects invalid amount %s', value => {
    expect(() => validateFields({monthlyAmount:value})).toThrow(BadRequestException)
  })
  it.each([{customerName:''}, {stage:'won'}, {dailyVolume:'10'}, {country:'XX'}, {registeredOn:'2026-02-30'}, {storeUrl:'javascript:alert(1)'}, {ownerUserId:'someone'}])('rejects invalid draft %j', value => {
    expect(() => validateFields(value, true)).toThrow(BadRequestException)
  })
  it('permits original FOP values and local ISO countries', () => {
    expect(validateFields({stage:'a_Place_an_order',dailyVolume:'fifty',country:'us',storeUrl:'https://shop.example'})).toMatchObject({country:'US',dailyVolume:'fifty'})
    const options = opportunityOptions()
    expect(options.stages).toHaveLength(7)
    expect(options.countries.find(c=>c.value==='US')?.label).toBe('美国')
    expect(options.dailyVolumes.find(c=>c.value==='twenty')?.label).toBe('11-20')
  })
  it('requires complete follow-up and does not convert missing amount to zero', () => {
    expect(() => validateFollowUp({followedOn:'2026-11-18',stage:'a_a_intentional_cooperation',dailyVolume:'ten',currentFollowUp:'已联系',nextFollowUpPlan:'再次联系'})).toThrow(BadRequestException)
  })
  it('keeps latest header for older follow-up while allowing the historical event', () => {
    const follow = validateFollowUp({followedOn:'2026-11-17',stage:'a_a_intentional_cooperation',dailyVolume:'ten',monthlyAmount:'0',currentFollowUp:'旧',nextFollowUpPlan:'计划'})
    expect(applyFollowUp({lastFollowedOn:'2026-11-18',currentFollowUp:'新'},follow)).toEqual({})
    expect(applyFollowUp({lastFollowedOn:null},follow)).toMatchObject({lastFollowedOn:'2026-11-17',currentFollowUp:'旧',monthlyAmount:'0'})
  })
  it('only allows current visible owner or administrator to write', () => {
    expect(canWrite({id:'a',role:'user',accountDisabled:false},'a',['a'])).toBe(true)
    expect(canWrite({id:'a',role:'user',accountDisabled:false},'b',['a','b'])).toBe(false)
    expect(canWrite({id:'a',role:'admin',accountDisabled:false},'b',['a','b'])).toBe(true)
    expect(canWrite({id:'a',role:'admin',accountDisabled:false},'c',['a','b'])).toBe(false)
    expect(canWrite({id:'a',role:'admin',accountDisabled:true},'a',['a'])).toBe(false)
  })
  it('conflicts on stale version and rejects missing version', () => {
    expect(() => assertVersion(2,1)).toThrow(ConflictException)
    expect(() => assertVersion(2,undefined)).toThrow(BadRequestException)
    expect(() => assertVersion(2,2)).not.toThrow()
  })
  it('validates query ranges and caps pages', () => {
    expect(validateQuery({page:'2',pageSize:'50',country:'us'})).toMatchObject({page:2,pageSize:50,country:'US'})
    expect(() => validateQuery({from:'2026-11-18',to:'2026-11-17'})).toThrow(BadRequestException)
    expect(() => validateQuery({pageSize:'10001'})).toThrow(BadRequestException)
  })
  it('exports exact amount and formula-like strings as plain cell text', async () => {
    const bytes = await exportWorkbook([{number:'SJ001',customerName:'=1+1',monthlyAmount:'1234567890123456.78',currency:'USD',stage:'a_Place_an_order'}])
    const wb = new Workbook(); await wb.xlsx.load(bytes as any)
    const row = wb.worksheets[0].getRow(2)
    expect(row.getCell(2).value).toBe('=1+1')
    expect(row.getCell(7).value).toBe('1234567890123456.78')
    expect(row.getCell(5).value).toBe('正式下单')
  })
})
