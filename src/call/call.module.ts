import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Call } from './entity/call.entity';
import { CallService } from './call.service';
import { CallController } from './call.controller';
import { CallAuthService } from './auth/call-auth.service';
import { CallGateway } from './call.gateway';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Call]),
    ClientsModule.registerAsync([
      {
        name: 'CALL_SERVICE',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (cfg: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: cfg.get<string>('CALL_TCP_HOST', 'localhost'),
            port: cfg.get<number>('CALL_TCP_PORT', 4008),
          },
        }),
      },
      {
        name: 'AUTH_SERVICE',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (cfg: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: cfg.get<string>('AUTH_TCP_HOST', 'localhost'),
            port: cfg.get<number>('AUTH_TCP_PORT', 5002),
          },
        }),
      },
    ]),
  ],
  providers: [CallAuthService, CallService, CallGateway],
  controllers: [CallController],
  exports: [CallService],
})
export class CallModule {}