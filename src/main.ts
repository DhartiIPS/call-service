import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);

  const tcpHost = configService.get<string>('CALL_TCP_HOST', '0.0.0.0');
  const tcpPort = configService.get<number>('CALL_TCP_PORT', 4008);

  app.enableCors({
    origin: [
      'https://frontend-eight-beryl-k9n74eselr.vercel.app',
      'http://localhost:3000',
    ],
    credentials: true,
  });

  // Connect microservice
  app.connectMicroservice({
    transport: Transport.TCP,
    options: {
      host: tcpHost,
      port: tcpPort,
    },
  });

  // Start microservices
  await app.startAllMicroservices();

  // HTTP server (REST APIs)
  const httpPort = configService.get<number>('CALL_HTTP_PORT', 5010);
  await app.listen(httpPort);

  console.log(`🚀 Call HTTP server running on port ${httpPort}`);
  console.log(`🚀 Call TCP microservice running on ${tcpHost}:${tcpPort}`);
}

bootstrap();
