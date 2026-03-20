import { Module } from '@nestjs/common'
import { ShopifySearchController } from './shopify-search.controller'
import { ShopifySearchService } from './shopify-search.service'

@Module({
  controllers: [ShopifySearchController],
  providers: [ShopifySearchService],
  exports: [ShopifySearchService],
})
export class ShopifySearchModule {}
