import {
  Controller,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Logger,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ShopifySearchService } from './shopify-search.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import * as fs from 'fs'
import * as path from 'path'
import { Throttle } from '@nestjs/throttler'
import { ShopifyImageUrlSearchDto, ShopifyKeywordSearchDto } from './dto/shopify-search.dto'

@Controller('shopify-search')
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 20, ttl: 60 * 1000 } })
export class ShopifySearchController {
  private readonly logger = new Logger(ShopifySearchController.name)
  constructor(private readonly shopifySearchService: ShopifySearchService) {}

  @Post('by-image-url')
  async searchByImageUrl(@Body() body: ShopifyImageUrlSearchDto) {
    this.logger.log(`收到图片URL搜索请求: ${body.imageUrl}`)
    try {
      const stores = await this.shopifySearchService.searchStoresByImageUrl(
        body.imageUrl,
      )
      this.logger.log(`图片URL搜索返回 ${stores.length} 个店铺`)
      const searchCountInfo = this.shopifySearchService.getSearchCountInfo()
      const noteContent =
        this.shopifySearchService.formatResultsAsNoteContent(stores, '图片URL', body.imageUrl, undefined, searchCountInfo)
      const noteTitle = this.shopifySearchService.generateNoteTitle('图片URL')

      return {
        stores,
        noteContent,
        noteTitle,
        searchCountInfo,
      }
    } catch (error) {
      this.logger.error(`图片URL搜索失败: ${error.message}`)
      throw error
    }
  }

  @Post('by-keyword')
  async searchByKeyword(@Body() body: ShopifyKeywordSearchDto) {
    this.logger.log(`收到关键词搜索请求: ${body.keyword}`)
    try {
      const stores = await this.shopifySearchService.searchStoresByKeyword(
        body.keyword,
      )
      this.logger.log(`关键词搜索返回 ${stores.length} 个店铺`)
      const searchCountInfo = this.shopifySearchService.getSearchCountInfo()
      const noteContent =
        this.shopifySearchService.formatResultsAsNoteContent(stores, '关键词', undefined, body.keyword, searchCountInfo)
      const noteTitle = this.shopifySearchService.generateNoteTitle('关键词', body.keyword)

      return {
        stores,
        noteContent,
        noteTitle,
        searchCountInfo,
      }
    } catch (error) {
      this.logger.error(`关键词搜索失败: ${error.message}`)
      throw error
    }
  }

  @Post('by-image-upload')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
      },
    }),
  )
  async searchByImageUpload(@UploadedFile() file: Express.Multer.File) {
    this.logger.log(`收到图片上传请求, 文件: ${file?.originalname}, 大小: ${file?.size}`)

    if (!file) {
      this.logger.warn('没有接收到图片文件')
      return {
        stores: [],
        noteContent: '请上传图片文件',
        noteTitle: '上传失败',
        error: '没有接收到图片文件',
      }
    }

    // 保存临时文件
    const uploadDir = path.join(process.cwd(), 'uploads', 'temp')

    // 确保目录存在
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }

    const filename = `search-${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`
    const filepath = path.join(uploadDir, filename)

    fs.writeFileSync(filepath, file.buffer)
    this.logger.log(`临时文件已保存: ${filepath}`)

    try {
      const stores =
        await this.shopifySearchService.searchStoresByImageFile(filepath)
      const searchCountInfo = this.shopifySearchService.getSearchCountInfo()
      const noteContent =
        this.shopifySearchService.formatResultsAsNoteContent(stores, '图片上传', undefined, undefined, searchCountInfo)
      const noteTitle = this.shopifySearchService.generateNoteTitle('图片上传')

      return {
        stores,
        noteContent,
        noteTitle,
        searchCountInfo,
      }
    } finally {
      // 清理临时文件
      try {
        fs.unlinkSync(filepath)
      } catch {
        // 忽略删除错误
      }
    }
  }
}
