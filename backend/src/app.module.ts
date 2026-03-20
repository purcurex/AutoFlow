import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthModule } from './modules/auth/auth.module'
import { UsersModule } from './modules/users/users.module'
import { NotesModule } from './modules/notes/notes.module'
import { FoldersModule } from './modules/folders/folders.module'
import { AiModule } from './modules/ai/ai.module'
import { ShopifySearchModule } from './modules/shopify-search/shopify-search.module'
import { FacebookAdsModule } from './modules/facebook-ads/facebook-ads.module'

@Module({
  imports: [
    // 配置模块
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // 数据库连接
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DB_HOST', 'localhost'),
        port: configService.get('DB_PORT', 5432),
        username: configService.get('DB_USERNAME', 'postgres'),
        password: configService.get('DB_PASSWORD', 'postgres'),
        database: configService.get('DB_DATABASE', 'noteflow'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: configService.get('NODE_ENV') !== 'production',
        logging: configService.get('NODE_ENV') === 'development',
      }),
      inject: [ConfigService],
    }),

    // 业务模块
    AuthModule,
    UsersModule,
    NotesModule,
    FoldersModule,
    AiModule,
    ShopifySearchModule,
    FacebookAdsModule,
  ],
})
export class AppModule {}
