import { config } from 'dotenv'
import { DataSource } from 'typeorm'
import * as bcrypt from 'bcrypt'
import { User } from '../modules/users/user.entity'
import { Note } from '../modules/notes/note.entity'
import { Folder } from '../modules/folders/folder.entity'

// 加载 .env 文件
config({ path: __dirname + '/../../.env' })

const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_DATABASE || 'noteflow',
  entities: [User, Note, Folder],
})

async function seed() {
  await AppDataSource.initialize()
  console.log('数据库连接成功')

  const userRepository = AppDataSource.getRepository(User)
  const noteRepository = AppDataSource.getRepository(Note)
  const folderRepository = AppDataSource.getRepository(Folder)

  // 检查测试用户是否存在（按邮箱或用户名查找）
  let testUser = await userRepository.findOne({
    where: [{ email: 'test@test.com' }, { username: 'testuser' }]
  })

  const hashedPassword = await bcrypt.hash('123456', 10)

  if (testUser) {
    // 更新现有用户的密码，确保可以登录
    testUser.email = 'test@test.com'
    testUser.username = 'testuser'
    testUser.password = hashedPassword
    await userRepository.save(testUser)
    console.log('测试用户已存在，密码已重置:')
    console.log('  邮箱: test@test.com')
    console.log('  密码: 123456')
  } else {
    // 创建测试用户
    testUser = userRepository.create({
      email: 'test@test.com',
      username: 'testuser',
      password: hashedPassword,
    })
    await userRepository.save(testUser)
    console.log('测试用户创建成功:')
    console.log('  邮箱: test@test.com')
    console.log('  密码: 123456')
  }

  // 创建测试文件夹
  let testFolder = await folderRepository.findOne({ where: { name: '测试文件夹' } })
  if (!testFolder) {
    testFolder = folderRepository.create({
      name: '测试文件夹',
      userId: testUser.id,
    })
    await folderRepository.save(testFolder)
    console.log('测试文件夹创建成功')
  }

  // 创建测试笔记
  const existingNotes = await noteRepository.count({ where: { userId: testUser.id } })
  if (existingNotes === 0) {
    const testNotes = [
      {
        title: '欢迎使用 NoteFlow',
        content: '# 欢迎使用 NoteFlow\n\n这是一款强大的笔记应用，支持：\n\n- Markdown 编辑\n- 文件夹管理\n- AI 智能助手\n- 标签分类\n\n开始你的笔记之旅吧！',
        userId: testUser.id,
        folderId: testFolder.id,
        tags: ['欢迎', '教程'],
      },
      {
        title: 'Markdown 语法示例',
        content: '# Markdown 语法示例\n\n## 文本格式\n\n**粗体** 和 *斜体* 和 ~~删除线~~\n\n## 列表\n\n1. 有序列表项 1\n2. 有序列表项 2\n\n- 无序列表项 1\n- 无序列表项 2\n\n## 代码\n\n```javascript\nconst hello = "Hello, World!"\nconsole.log(hello)\n```\n\n## 引用\n\n> 这是一段引用文本\n\n## 链接和图片\n\n[点击这里](https://example.com)',
        userId: testUser.id,
        folderId: testFolder.id,
        tags: ['Markdown', '教程'],
      },
    ]

    for (const noteData of testNotes) {
      const note = noteRepository.create(noteData)
      await noteRepository.save(note)
    }
    console.log('测试笔记创建成功')
  }

  await AppDataSource.destroy()
  console.log('\n种子数据初始化完成!')
}

seed().catch((error) => {
  console.error('种子数据初始化失败:', error)
  process.exit(1)
})
