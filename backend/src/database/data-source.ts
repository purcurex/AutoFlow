import { config } from 'dotenv'
import { resolve } from 'path'
import { DataSource } from 'typeorm'
import { environmentFiles } from '../config/env-files'

for (const file of environmentFiles()) config({ path: resolve(process.cwd(), file), override: false })

const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_DATABASE || 'autoflow',
  ssl: process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : false,
  entities: [resolve(__dirname, '../modules/**/*.entity{.ts,.js}')],
  migrations: [resolve(__dirname, 'migrations/[0-9]*{.ts,.js}')],
  migrationsTableName: 'typeorm_migrations',
  migrationsTransactionMode: 'each',
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
})

export default AppDataSource
