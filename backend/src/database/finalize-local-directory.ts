import { readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'
import dataSource from './data-source'
import { consolidateLocalDirectory } from './consolidate-local-directory'

async function main() {
  const args = process.argv.slice(2)
  const value = (name: string) => args[args.indexOf(name) + 1]
  if (!args.includes('--apply') || !args.includes('--database') || value('--database') !== dataSource.options.database
    || !args.includes('--import-report') || !args.includes('--password-file') || !args.includes('--report')) throw new Error('Required: --apply --database DB --import-report FILE --password-file FILE --report FILE [--remove-email EMAIL]')
  const imported = JSON.parse(await readFile(resolve(value('--import-report')), 'utf8')) as { applied: boolean; accounts: {email: string}[] }
  if (!imported.applied) throw new Error('必须提供已成功执行的导入报告')
  const keepEmails = imported.accounts.map(account => account.email)
  const removeEmails = args.flatMap((arg, i) => arg === '--remove-email' ? [args[i + 1]] : [])
  const password = (await readFile(resolve(value('--password-file')), 'utf8')).replace(/\r?\n$/, '')
  const report = resolve(value('--report'))
  await dataSource.initialize()
  try {
    const result = await consolidateLocalDirectory(dataSource, { keepEmails, removeEmails, password, backupDirectory: resolve(report, '..', 'backups') })
    await writeFile(report, JSON.stringify(result, null, 2), { mode: 0o600 })
    console.log(JSON.stringify({ admin: 'admin@hzdrop.com', employees: result.keptEmployees, removed: result.removedEmails }))
  } finally { await dataSource.destroy() }
}
main().catch(error => { console.error(error instanceof Error ? error.message : '账号整理失败'); process.exitCode = 1 })
