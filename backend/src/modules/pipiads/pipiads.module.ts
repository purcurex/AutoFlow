import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { PipiAdsService } from './pipiads.service'

@Module({
  imports: [ConfigModule],
  providers: [PipiAdsService],
  exports: [PipiAdsService],
})
export class PipiAdsModule {}
