import { Workbook } from 'exceljs'
import { readFile, mkdir, writeFile } from 'fs/promises'
import { resolve } from 'path'
import dataSource from './data-source'
import { directoryMembers } from '../modules/organization/company-directory'
import { provisionCompanyDirectory } from './provision-company-directory'

async function main() {
  const args = process.argv.slice(2), apply = args.includes('--apply')
  const option = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
  const file = option('--file'), report = option('--report')
  if (!file || !report) throw new Error('Usage: --file contacts.xlsx --report /private/report.json [--apply --database DB_NAME --password-file /private/password]')
  if (apply && option('--database') !== dataSource.options.database) throw new Error('执行时必须用 --database 明确指定实际目标库')
  const book = new Workbook(); await book.xlsx.readFile(resolve(file))
  const sheet = book.getWorksheet('成员列表')
  if (!sheet) throw new Error('工作簿缺少成员列表页')
  const rows: unknown[][] = []
  sheet.eachRow({ includeEmpty: true }, row => {
    const values: unknown[] = []
    for (let i = 1; i <= sheet.columnCount; i++) {
      const cell = row.getCell(i)
      if (cell.formula) throw new Error(`通讯录不接受公式单元格 ${cell.address}`)
      values.push(cell.text)
    }
    rows.push(values)
  })
  const members = directoryMembers(rows)
  const passwordFile = option('--password-file')
  const password = apply && passwordFile ? (await readFile(resolve(passwordFile), 'utf8')).replace(/\r?\n$/, '') : undefined
  await dataSource.initialize()
  try {
    const result = await provisionCompanyDirectory(dataSource, members, { apply, password, backupDirectory: resolve(report, '..', 'backups') })
    await mkdir(resolve(report, '..'), { recursive: true, mode: 0o700 })
    await writeFile(resolve(report), JSON.stringify(result, null, 2), { mode: 0o600 })
    console.log(JSON.stringify({ applied: result.applied, total: result.total, created: result.created, updated: result.updated, report: resolve(report), backup: result.backupPath }))
  } finally { await dataSource.destroy() }
}
main().catch(error => { console.error(error instanceof Error ? error.message : '通讯录导入失败'); process.exitCode = 1 })
