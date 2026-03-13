import { MigrationInterface, QueryRunner } from "typeorm";

export class ChatMessageTable1768906037439 implements MigrationInterface {
    name = 'ChatMessageTable1768906037439'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "chats" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "senderId" character varying NOT NULL, "receiverId" character varying NOT NULL, "message" text NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_0117647b3c4a4e5ff198aeb6206" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "chats"`);
    }

}
