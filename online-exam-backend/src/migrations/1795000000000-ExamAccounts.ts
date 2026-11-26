import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExamAccounts1795000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    await queryRunner.query('ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false');
  }

  async down(queryRunner: QueryRunner) {
    await queryRunner.query('ALTER TABLE users DROP COLUMN must_change_password');
  }
}
