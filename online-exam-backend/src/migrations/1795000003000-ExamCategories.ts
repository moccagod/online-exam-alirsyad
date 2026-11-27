import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExamCategories1795000003000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(`
      create table exam_categories (
        id uuid primary key default gen_random_uuid(),
        name varchar(120) not null,
        created_at timestamptz not null default now(),
        created_by uuid,
        updated_at timestamptz,
        updated_by uuid,
        constraint exam_categories_name_not_blank check (length(btrim(name)) > 0)
      );
      create unique index exam_categories_name_unique on exam_categories (lower(name));
      alter table exams add column category_id uuid references exam_categories(id);
      create index exams_category_active_idx on exams(category_id) where deleted_at is null;

      alter table exam_categories enable row level security;
      revoke all on exam_categories from public, anon, authenticated;
      grant all on exam_categories to service_role;
    `);
  }

  async down(_runner: QueryRunner) {
    throw new Error('Migrasi kategori ujian tidak boleh dibatalkan pada database produksi.');
  }
}
