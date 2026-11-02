import { randomBytes } from 'crypto'
import { execFileSync } from 'child_process'
import { mkdir, writeFile } from 'fs/promises'
import { dirname, relative, resolve, sep } from 'path'
import dataSource from './data-source'
import { assertLocalRoleDatabase, provisionLocalRoleAccounts } from './provision-local-role-accounts'

/** 输出必须位于仓库忽略的.runtime目录；Windows额外移除继承权限，只授权当前用户。 */
async function preparePrivateOutput(file: string) {
  const runtime = resolve(__dirname, '../../../.runtime'), target = resolve(file)
  const inside = relative(runtime, target)
  if (!inside || inside.startsWith(`..${sep}`) || inside === '..' || inside.includes(':')) throw new Error('输出必须位于项目.runtime目录')
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  if (process.platform === 'win32') {
    const identity = execFileSync('whoami', [], { encoding: 'utf8', windowsHide: true }).trim()
    execFileSync('icacls', [dirname(target), '/inheritance:r', '/grant:r', `${identity}:(OI)(CI)F`], { stdio: 'pipe', windowsHide: true })
  }
  return target
}

/** 显式运行的本地初始化命令；默认只预览，不启动HTTP服务、不联系金蝶、不自动执行迁移。 */
async function main() {
  const args = process.argv.slice(2)
  const value = (key: string) => { const i = args.indexOf(key); return i >= 0 ? args[i + 1] : undefined }
  const database = value('--database'), report = value('--report'), apply = args.includes('--apply')
  if (!database || !report) throw new Error('需要 --database DB --report FILE [--owner-email EMAIL] [--apply --credentials-file FILE]')
  assertLocalRoleDatabase(dataSource, database)
  dataSource.setOptions({ logging: false }) // 避免开发日志输出INSERT参数中的密码散列。
  await dataSource.initialize()
  try {
    if (await dataSource.showMigrations()) throw new Error('数据库有待执行迁移，请先核对并执行迁移，本命令不会自动改表')
    const options = { database, ownerEmail: value('--owner-email') ?? 'admin@noteflow.com', apply: false }
    const preview = await provisionLocalRoleAccounts(dataSource, options)
    const reportFile = await preparePrivateOutput(report)
    if (!apply) {
      await writeFile(reportFile, JSON.stringify(preview, null, 2), { mode: 0o600, flag: 'wx' })
      console.log(JSON.stringify(preview)); return
    }
    const passwords: Record<string, string> = {}
    const newAccounts = preview.accounts.filter(account => account.status === 'planned')
    if (newAccounts.length) {
      const credentials = value('--credentials-file')
      if (!credentials || resolve(credentials) === reportFile) throw new Error('新增账号需要独立的 --credentials-file，且不能与报告同名')
      const credentialsFile = await preparePrivateOutput(credentials)
      for (const account of newAccounts) passwords[account.email] = randomBytes(24).toString('base64url')
      // 先安全落盘口令再写数据库，写入失败时不会留下无法交接密码的账号；从不打印口令。
      await writeFile(credentialsFile, JSON.stringify({ database, accounts: newAccounts.map(account => ({ email: account.email, password: passwords[account.email] })) }, null, 2), { mode: 0o600, flag: 'wx' })
    }
    // 执行前预留报告，避免提交后因同名覆盖失败；事务失败则报告明确保持未执行状态。
    await writeFile(reportFile, JSON.stringify({ applied: false, status: 'pending' }), { mode: 0o600, flag: 'wx' })
    const result = await provisionLocalRoleAccounts(dataSource, { ...options, apply: true, passwords })
    await writeFile(reportFile, JSON.stringify(result, null, 2), { mode: 0o600 })
    console.log(JSON.stringify(result))
  } finally { await dataSource.destroy() }
}

main().catch(() => { console.error('本机测试账号初始化失败；请核对迁移、目录、测试身份冲突及输出文件是否已存在。口令不会输出到日志。'); process.exitCode = 1 })
