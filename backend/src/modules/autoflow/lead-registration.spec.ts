import { Workbook } from 'exceljs'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { RegisterLeadDto, ListLeadsQueryDto } from './dto/autoflow.dto'
import { leadTemplate, readLeadWorkbook } from './lead-registration'
async function workbook(rows: unknown[][]) { const w=new Workbook();const s=w.addWorksheet('leads');rows.forEach(r=>s.addRow(r));return Buffer.from(await w.xlsx.writeBuffer()) }
describe('lead registration import contract',()=>{
 it('creates a template with required headers and no editable origin',async()=>{const w=new Workbook();await w.xlsx.load(await leadTemplate() as any);const row=w.worksheets[0].getRow(1);expect(row.values).toEqual(expect.arrayContaining(['客户名称','国家','店铺链接']));expect(row.values).not.toContain('线索类型')})
 it('validates each row, skips blanks, supports Excel dates, and rejects formulas',async()=>{
  const rows=await readLeadWorkbook(await workbook([['客户名称','国家','店铺链接','联系日期'],['Acme','US','https://acme.example',new Date('2026-11-18T00:00:00Z')],[],['Broken','US','javascript:alert(1)'],['Formula','US',{formula:'"https://bad.example"',result:'https://bad.example'}]]))
  expect(rows).toHaveLength(3);expect(rows[0]).toMatchObject({row:2,data:{contactedOn:'2026-11-18'}});expect(rows[0].error).toBeUndefined();expect(rows[1].error).toContain('店铺链接');expect(rows[2].error).toContain('公式')
 })
 it('rejects missing required columns',async()=>{await expect(readLeadWorkbook(await workbook([['客户名称'],['Acme']]))).rejects.toThrow('国家')})
 it('rejects caller supplied origin and owner',async()=>{const dto=plainToInstance(RegisterLeadDto,{brandName:'Acme',country:'US',storeUrl:'https://acme.example',leadType:'automatic',ownerUserId:'someone'});const errors=await validate(dto,{whitelist:true,forbidNonWhitelisted:true});expect(errors.map(e=>e.property)).toEqual(expect.arrayContaining(['leadType','ownerUserId']))})
})

it('validates lead date sorting fields and directions',async()=>{
 expect(await validate(plainToInstance(ListLeadsQueryDto,{sortBy:'contactedOn',sortDirection:'asc'}))).toHaveLength(0)
 const errors=await validate(plainToInstance(ListLeadsQueryDto,{sortBy:'ownerUserId',sortDirection:'DESC NULLS FIRST'}))
 expect(errors.map(e=>e.property)).toEqual(expect.arrayContaining(['sortBy','sortDirection']))
})
