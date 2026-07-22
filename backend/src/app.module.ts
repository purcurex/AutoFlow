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
import { SeederModule } from './modules/seeder/seeder.module'
import { AutoflowModule } from './modules/autoflow/autoflow.module'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { validateEnvironment } from './config/environment'
import { HealthModule } from './modules/health/health.module'
import { FopIntegrationModule } from './modules/fop-integration/fop-integration.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: validateEnvironment,
    }),

    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60 * 1000,
        limit: 120,
      },
    ]),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DB_HOST', 'localhost'),
        port: configService.get('DB_PORT', 5432),
        username: configService.get('DB_USERNAME', 'postgres'),
        password: configService.get('DB_PASSWORD', 'postgres'),
        database: configService.get('DB_DATABASE', 'autoflow'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        migrations: [__dirname + '/database/migrations/[0-9]*{.ts,.js}'],
        migrationsTableName: 'typeorm_migrations',
        synchronize: configService.get('DB_SYNCHRONIZE', 'false') === 'true',
        migrationsRun: configService.get('DB_MIGRATIONS_RUN', 'false') === 'true',
        logging: configService.get('NODE_ENV') === 'development',
      }),
      inject: [ConfigService],
    }),

    AuthModule,
    UsersModule,
    NotesModule,
    FoldersModule,
    AiModule,
    ShopifySearchModule,
    FacebookAdsModule,
    AutoflowModule,
    SeederModule,
    HealthModule,
    FopIntegrationModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
