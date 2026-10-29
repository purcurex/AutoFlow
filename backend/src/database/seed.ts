import * as bcrypt from 'bcrypt'
import { User } from '../modules/users/user.entity'
import { Note } from '../modules/notes/note.entity'
import { Folder } from '../modules/folders/folder.entity'
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
  const noteRepository = AppDataSource.getRepository(Note)
  const folderRepository = AppDataSource.getRepository(Folder)

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

  let salesFolder = await folderRepository.findOne({
    where: { name: 'Customer Development Records' },
  })

  if (!salesFolder) {
    salesFolder = folderRepository.create({
      name: 'Customer Development Records',
      userId: testUser.id,
    })
    await folderRepository.save(salesFolder)
    console.log('Customer development record category created')
  }

  const existingNotes = await noteRepository.count({ where: { userId: testUser.id } })
  if (existingNotes === 0) {
    const records = [
      {
        title: 'AutoFlow Customer Development Playbook',
        content:
          '# AutoFlow Customer Development Playbook\n\nUse this workspace to track product ideas, target stores, buyer contacts, outreach drafts, quotes, and CRM follow-up notes for Dropshipping sales development.',
        userId: testUser.id,
        folderId: salesFolder.id,
        tags: ['autoflow', 'sales'],
      },
      {
        title: 'Sample Outreach Research Record',
        content:
          '# Sample Outreach Research Record\n\n- Product keyword: phone case\n- Target store: example-shop.myshopify.com\n- Channel: WhatsApp\n- Next action: verify contact and prepare first message',
        userId: testUser.id,
        folderId: salesFolder.id,
        tags: ['lead', 'outreach'],
      },
    ]

    for (const recordData of records) {
      const record = noteRepository.create(recordData)
      await noteRepository.save(record)
    }
    console.log('Sample sales records created')
  }

  await AppDataSource.destroy()
  console.log('Seed data initialized')
}

seed().catch((error) => {
  console.error('Seed data initialization failed', error)
  process.exit(1)
})
