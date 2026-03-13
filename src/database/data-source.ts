import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { Chat } from '../chat/entity/chat.entity';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'microservice_db',

  entities: [Chat],
  migrations: ['src/database/migrations/*{.ts,.js}'],

  synchronize: false,
  logging: true,
});
