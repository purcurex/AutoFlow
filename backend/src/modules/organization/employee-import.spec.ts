import { Workbook } from 'exceljs'
import { previewEmployeeImport } from './employee-import'
const file = (name: string, data: Buffer | string) => ({ originalname: name, buffer: Buffer.isBuffer(data) ? data : Buffer.from(data) }) as Express.Multer.File
describe('employee import preview', () => {
  it('reads Excel text fields and keeps leading zero phone numbers', async () => {
    const book = new Workbook(), sheet = book.addWorksheet('员工')
    sheet.addRow(['姓名', '员工编号', '邮箱', '职务', '手机'])
    sheet.addRow(['员工（Amy）', '001', 'AMY@example.test', '外贸业务员', '010101'])
    const result = await previewEmployeeImport(file('employees.xlsx', Buffer.from(await book.xlsx.writeBuffer())))
    expect(result).toMatchObject({ employees: [{ name: '员工（Amy）', code: '001', email: 'amy@example.test', phone: '010101' }], errors: [] })
  })
  it('rejects formulas, invalid headers and more than 100 rows', async () => {
    const book = new Workbook(), sheet = book.addWorksheet('员工')
    sheet.addRow(['姓名', '员工编号', '邮箱', '职务', '手机'])
    sheet.addRow([{ formula: '1+1', result: 2 }, '001', 'amy@example.test', '', ''])
    expect((await previewEmployeeImport(file('formulas.xlsx', Buffer.from(await book.xlsx.writeBuffer())))).errors[0]).toMatchObject({ row: 2, message: expect.stringContaining('公式') })
    await expect(previewEmployeeImport(file('wrong.csv', '姓名,错误列\n甲,1'))).rejects.toThrow('表头')
    await expect(previewEmployeeImport(file('large.csv', '姓名,员工编号,邮箱,职务,手机\n' + Array.from({ length: 101 }, (_, i) => `甲,${i},a${i}@example.test,,`).join('\n')))).rejects.toThrow('1–100')
  })
  it('reports duplicate rows and invalid addresses without creating members', async () => {
    const result = await previewEmployeeImport(file('duplicates.csv', '姓名,员工编号,邮箱,职务,手机\n甲,001,not-email,,\n乙,001,b@example.test,,'))
    expect(result.errors.map(row => row.row)).toEqual([2, 3])
  })
})
