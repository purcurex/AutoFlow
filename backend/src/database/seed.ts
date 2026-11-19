import * as bcrypt from 'bcrypt'
import { User } from '../modules/users/user.entity'
import AppDataSource from './data-source'

async function seed() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Development seed data cannot run in production.')
  }

  await AppDataSource.initialize()
  console.log('Database connected')

  const userRepository = AppDataSource.getRepository(User)
  // An explicitly initialized company directory must never recreate the retired
  // synthetic account or reset the administrator password on local restart.
  if (await userRepository.existsBy({ email: 'admin@hzdrop.com' })
    || (await AppDataSource.query("SELECT EXISTS(SELECT 1 FROM organization_employees WHERE directory_profile->>'source' = 'company-directory') AS ready"))[0].ready) {
    console.log('Company directory already initialized; demo account seeding skipped.')
    await AppDataSource.destroy()
    return
  }

  let testUser = await userRepository.findOne({
    where: [{ email: 'test@autoflow.local' }, { username: 'sales_user' }],
  })

  const devPassword = process.env.DEV_SEED_PASSWORD || 'AutoFlowLocal123'
  const hashedPassword = await bcrypt.hash(devPassword, 10)

  if (testUser) {
    testUser.email = 'test@autoflow.local'
    testUser.username = 'sales_user'
    testUser.password = hashedPassword
    await userRepository.save(testUser)
    console.log('Sales test user reset')
  } else {
    testUser = userRepository.create({
      email: 'test@autoflow.local',
      username: 'sales_user',
      password: hashedPassword,
    })
    await userRepository.save(testUser)
    console.log('Sales test user created')
  }

  console.log('  email: test@autoflow.local')
  console.log('  password: configured by DEV_SEED_PASSWORD (local default is documented in .env.example)')

  await AppDataSource.destroy()
  console.log('Seed data initialized')
}

seed().catch((error) => {
  console.error('Seed data initialization failed', error)
  process.exit(1)
})
