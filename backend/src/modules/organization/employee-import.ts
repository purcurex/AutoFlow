import { BadRequestException } from '@nestjs/common'
import { Workbook } from 'exceljs'
import { Readable } from 'stream'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { EmployeeProfileDto } from './organization.dto'

export async function previewEmployeeImport(file: Express.Multer.File) {
  if (!file?.buffer?.length) throw new BadRequestException('请选择 Excel (.xlsx) 或 UTF-8 CSV 文件')
  const book = new Workbook()
  try {
    if (/\.xlsx$/i.test(file.originalname)) await book.xlsx.load(file.buffer as unknown as Parameters<Workbook['xlsx']['load']>[0])
    else if (/\.csv$/i.test(file.originalname)) await book.csv.read(Readable.from([file.buffer.toString('utf8').replace(/^\uFEFF/, '')]), { map: value => value })
    else throw new Error('unsupported')
  } catch { throw new BadRequestException('文件无法读取，请使用 Excel (.xlsx) 或 UTF-8 CSV 模板') }
  const sheet = book.worksheets[0]
  if (!sheet || sheet.rowCount > 101) throw new BadRequestException('每次导入1–100名成员，请拆分文件后重试')
  const columns = ['姓名', '员工编号', '邮箱', '职务', '手机']
  if (columns.some((name, index) => sheet.getCell(1, index + 1).text.trim() !== name) || sheet.columnCount > columns.length) throw new BadRequestException('表头必须依次为：姓名、员工编号、邮箱、职务、手机')
  const employees: EmployeeProfileDto[] = [], rowNumbers: number[] = [], errors: { row: number; message: string }[] = []
  const codes = new Set<string>(), emails = new Set<string>()
  for (let row = 2; row <= sheet.rowCount; row++) {
    const cells = columns.map((_name, index) => sheet.getCell(row, index + 1))
    if (cells.every(cell => cell.value === null || cell.text.trim() === '')) continue
    if (cells.some(cell => cell.value !== null && typeof cell.value === 'object')) { errors.push({ row, message: '不支持公式、链接或复杂单元格，请粘贴为纯文本' }); continue }
    const [name, code, email, jobTitle, phone] = cells.map(cell => cell.text.trim())
    const employee = plainToInstance(EmployeeProfileDto, { name, code, email, jobTitle, phone })
    const invalid = await validate(employee, { whitelist: true, forbidNonWhitelisted: true })
    if (invalid.length) errors.push({ row, message: '请检查姓名、编号、邮箱格式及字段长度' })
    if (codes.has(employee.code) || emails.has(employee.email)) errors.push({ row, message: '文件内员工编号或邮箱重复' })
    codes.add(employee.code); emails.add(employee.email); employees.push(employee); rowNumbers.push(row)
  }
  if (!employees.length && !errors.length) errors.push({ row: 2, message: '文件没有成员数据' })
  return { employees, rowNumbers, errors }
}
