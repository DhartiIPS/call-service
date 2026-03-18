import { MigrationInterface, QueryRunner } from "typeorm";

export class CreatecallerTable1773724251296 implements MigrationInterface {
    name = 'CreatecallerTable1773724251296'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "calls" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "caller_id" character varying NOT NULL, "receiver_id" character varying NOT NULL, "room_id" character varying NOT NULL, "call_type" "public"."calls_call_type_enum" NOT NULL, "status" "public"."calls_status_enum" NOT NULL DEFAULT 'initiated', "started_at" TIMESTAMP WITH TIME ZONE, "ended_at" TIMESTAMP WITH TIME ZONE, "duration" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_acdd3afab4f4cda873dd1f07191" UNIQUE ("room_id"), CONSTRAINT "PK_d9171d91f8dd1a649659f1b6a20" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_5eed7130d6c26f8623dfdc38b9" ON "calls" ("receiver_id", "created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_63ae2152fde2f6f70138d1aec0" ON "calls" ("caller_id", "created_at") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        console.log('Reverting CreatecallerTable1773724251296 migration');
    }

}
