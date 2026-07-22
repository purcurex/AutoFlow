import { Injectable, Logger } from '@nestjs/common'
import { UsersService } from '../users/users.service'
import { UserRole } from '../users/user.entity'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class SeederService {
  private readonly logger = new Logger(SeederService.name)

  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  async seedAdmin(): Promise<void> {
    if (this.configService.get<string>('ENABLE_ADMIN_BOOTSTRAP', 'false') !== 'true') {
      this.logger.log('Admin bootstrap is disabled')
      return
    }

    const adminEmail = this.configService.getOrThrow<string>('ADMIN_BOOTSTRAP_EMAIL')
    const adminUsername = this.configService.getOrThrow<string>('ADMIN_BOOTSTRAP_USERNAME')
    const adminPassword = this.configService.getOrThrow<string>('ADMIN_BOOTSTRAP_PASSWORD')

    try {
      const [existingEmail, existingUsername] = await Promise.all([
        this.usersService.findByEmail(adminEmail),
        this.usersService.findByUsername(adminUsername),
      ])
      if (existingEmail || existingUsername) {
        this.logger.log('AutoFlow admin account already exists')
        return
      }

      await this.usersService.create(
        adminEmail,
        adminUsername,
        adminPassword,
        UserRole.ADMIN,
      )
      this.logger.log('AutoFlow admin account created')
      this.logger.log(`Email: ${adminEmail}`)
      this.logger.log(`Username: ${adminUsername}`)
      this.logger.warn('Please change the default admin password immediately.')
    } catch (error) {
      this.logger.error('Failed to create AutoFlow admin account', error)
    }
  }
}
