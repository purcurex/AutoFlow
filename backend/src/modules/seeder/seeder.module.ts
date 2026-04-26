import { Module, OnModuleInit } from '@nestjs/common'
import { SeederService } from './seeder.service'
import { UsersModule } from '../users/users.module'

@Module({
  imports: [UsersModule],
  providers: [SeederService],
  exports: [SeederService],
})
export class SeederModule implements OnModuleInit {
  constructor(private readonly seederService: SeederService) {}

  async onModuleInit() {
    await this.seederService.seedAdmin()
  }
}
