import { Injectable, Logger } from '@nestjs/common'
import { UsersService } from '../users/users.service'
import { UserRole } from '../users/user.entity'

@Injectable()
export class SeederService {
  private readonly logger = new Logger(SeederService.name)

  constructor(private readonly usersService: UsersService) {}

  async seedAdmin(): Promise<void> {
    const adminEmail = 'admin@noteflow.com'
    const adminUsername = 'admin'
    const adminPassword = 'Admin@123456'

    try {
      const existingAdmin = await this.usersService.findByEmail(adminEmail)
      if (existingAdmin) {
        this.logger.log('管理员账号已存在')
        return
      }

      await this.usersService.create(
        adminEmail,
        adminUsername,
        adminPassword,
        UserRole.ADMIN,
      )
      this.logger.log('管理员账号创建成功')
      this.logger.log(`邮箱: ${adminEmail}`)
      this.logger.log(`用户名: ${adminUsername}`)
      this.logger.log(`密码: ${adminPassword}`)
      this.logger.warn('请及时修改默认管理员密码！')
    } catch (error) {
      this.logger.error('创建管理员账号失败', error)
    }
  }
}
