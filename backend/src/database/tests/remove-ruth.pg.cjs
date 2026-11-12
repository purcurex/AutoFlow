/* Opt-in local validation only; all deletes roll back. Never opens the business database. */
require('reflect-metadata')
require('ts-node').register({ project: 'backend/tsconfig.json', transpileOnly: true })
const fs = require('node:fs'), assert = require('node:assert/strict'), { DataSource } = require('typeorm')
const { RemoveDepartedRuth1794398400000 } = require('../migrations/1794398400000-RemoveDepartedRuth')
const database = process.env.WORKBENCH_VALIDATION_DATABASE || 'hz_ddl_validation_1794392169018'
assert.match(database, /^hz_ddl_validation_\d+$/)
;(async () => {
  const db = new DataSource({ type: 'postgres', host: '127.0.0.1', port: 55432, username: 'autoflow_demo', database,
    password: fs.readFileSync('.runtime/local-demo/database-password', 'utf8').trim() })
  await db.initialize(); const runner = db.createQueryRunner(); await runner.connect(); await runner.startTransaction()
  try {
    const [before] = await runner.query("SELECT count(*)::int n FROM users WHERE lower(email)='ruth@hzdrop.com'")
    assert.equal(before.n, 1, 'Use the restored validation database containing the pre-deletion account')
    const migration = new RemoveDepartedRuth1794398400000()
    await migration.up(runner)
    const [after] = await runner.query("SELECT (SELECT count(*)::int FROM users WHERE lower(email)='ruth@hzdrop.com') accounts,(SELECT count(*)::int FROM organization_employees WHERE lower(email)='ruth@hzdrop.com') employees")
    assert.deepEqual(after, { accounts: 0, employees: 0 })
    await migration.up(runner)
    await runner.rollbackTransaction()
    assert.equal((await runner.query("SELECT count(*)::int n FROM users WHERE lower(email)='ruth@hzdrop.com'"))[0].n, 1)
    console.log(JSON.stringify({ database, status: 'passed', accountRemoved: true, employeeRemoved: true, idempotent: true, rolledBack: true }))
  } finally { if (runner.isTransactionActive) await runner.rollbackTransaction(); await runner.release(); await db.destroy() }
})().catch(error => { console.error(error.message); process.exitCode = 1 })
