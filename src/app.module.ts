import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Call } from './call/entity/call.entity';
import { CallModule } from './call/call.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres',
        host:     cfg.get('DB_HOST', 'localhost'),
        port:     cfg.get<number>('DB_PORT', 5432),
        username: cfg.get('DB_USERNAME', 'postgres'),
        password: cfg.get('DB_PASSWORD', 'ips12345'),
        database: cfg.get('DB_NAME', 'chat_db'),
        entities: [Call],
        synchronize: false,
        ssl: false,
      }),
    }),

    CallModule,
  ],
})
export class AppModule {}
