import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveExamRecordingColumns1795000005000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      do $$ begin
        if exists(select 1 from storage.buckets where id = 'exam-recordings') then
          raise exception 'Hapus bucket exam-recordings melalui Storage API sebelum menghapus kolom rekaman';
        end if;
      end $$;
      alter table exam_submissions
        drop column if exists file_name,
        drop column if exists file_path,
        drop column if exists file_url,
        drop column if exists recording_files;
    `);
  }

  public async down(): Promise<void> {
    throw new Error('Data rekaman yang dihapus tidak dapat dipulihkan melalui migration:revert.');
  }
}
