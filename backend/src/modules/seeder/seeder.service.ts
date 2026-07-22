import { Injectable, Logger } from '@nestjs/common'
import { UsersService } from '../users/users.service'
import { UserRole } from '../users/user.entity'

@Injectable()
export class SeederService {
  private readonly logger = new Logger(SeederService.name)

  constructor(private readonly usersService: UsersService) {}

  async seedAdmin(): Promise<void> {
    const adminEmail = 'admin@autoflow.local'
    const adminUsername = 'admin'
    const adminPassword = 'Admin@123456'

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
      this.logger.log(`Password: ${adminPassword}`)
      this.logger.warn('Please change the default admin password immediately.')
    } catch (error) {
      this.logger.error('Failed to create AutoFlow admin account', error)
    }
  }
}
