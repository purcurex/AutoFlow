import 'reflect-metadata'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config } from 'dotenv'
import { DataSource } from 'typeorm'

const action = process.argv[2] || 'show'
const confirmedRevert = process.argv.includes('--confirm-revert')
const root = resolve(import.meta.dirname, '..', '..')
const backendRoot = resolve(root, 'backend')
const envPath = resolve(backendRoot, '.env')

if (existsSync(envPath)) {
  config({ path: envPath, override: false })
}

for (const key of ['DB_HOST', 'DB_USERNAME', 'DB_PASSWORD', 'DB_DATABASE']) {
  if (!String(process.env[key] || '').trim()) {
    throw new Error(`${key} must be provided through backend/.env or the process environment.`)
  }
}

const normalizeGlob = (value) => value.replaceAll('\\', '/')
const sslEnabled = process.env.DB_SSL === 'true'
const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  ssl: sslEnabled
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : false,
  entities: [normalizeGlob(resolve(backendRoot, 'dist', 'src', 'modules', '**', '*.entity.js'))],
  migrations: [normalizeGlob(resolve(backendRoot, 'dist', 'src', 'database', 'migrations', '[0-9]*.js'))],
  migrationsTableName: 'typeorm_migrations',
  synchronize: false,
  logging: false,
})

async function appliedMigrations() {
  try {
    return await dataSource.query(
      'SELECT "timestamp", "name" FROM "typeorm_migrations" ORDER BY "timestamp" ASC',
    )
  } catch (error) {
    if (error?.code === '42P01') return []
    throw error
  }
}

async function main() {
  await dataSource.initialize()
  const registered = dataSource.migrations.length

  if (action === 'show') {
    const applied = await appliedMigrations()
    const hasPending = await dataSource.showMigrations()
    console.log(`Database connection: ok`)
    console.log(`Registered migrations: ${registered}`)
    console.log(`Applied migrations: ${applied.length}`)
    console.log(`Pending migrations: ${hasPending ? 'yes' : 'no'}`)
    return
  }

  if (action === 'run') {
    const executed = await dataSource.runMigrations({ transaction: 'all' })
    console.log(`Executed migrations: ${executed.length}`)
    for (const migration of executed) console.log(`  + ${migration.name}`)
    if (executed.length === 0) console.log('Database schema is already current.')
    return
  }

  if (action === 'revert') {
    if (!confirmedRevert) {
      throw new Error('Reverting is destructive. Add --confirm-revert after taking a database backup.')
    }
    await dataSource.undoLastMigration({ transaction: 'all' })
    console.log('Latest migration reverted.')
    return
  }

  throw new Error(`Unsupported action "${action}". Use show, run, or revert.`)
}

main()
  .finally(async () => {
    if (dataSource.isInitialized) await dataSource.destroy()
  })
  .catch((error) => {
    console.error(`Migration command failed: ${error.message}`)
    process.exitCode = 1
  })
