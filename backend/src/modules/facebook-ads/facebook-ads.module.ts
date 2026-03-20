import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { FacebookAdsController } from './facebook-ads.controller'
import { FacebookAdsService } from './facebook-ads.service'

@Module({
  imports: [ConfigModule],
  controllers: [FacebookAdsController],
  providers: [FacebookAdsService],
  exports: [FacebookAdsService],
})
export class FacebookAdsModule {}
