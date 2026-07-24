import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { Alibaba1688Service } from './alibaba1688.service'

@Module({
  imports: [ConfigModule],
  providers: [Alibaba1688Service],
  exports: [Alibaba1688Service],
})
export class Alibaba1688Module {}
