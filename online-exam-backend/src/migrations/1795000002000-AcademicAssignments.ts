import { MigrationInterface, QueryRunner } from 'typeorm';

export class AcademicAssignments1795000002000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(`
      alter table subjects alter column class_id drop not null;
      alter table subjects add column canonical_subject_id uuid references subjects(id);

      with ranked as (
        select id, first_value(id) over (
          partition by lower(trim(name)) order by created_at, id
        ) canonical_id
        from subjects where deleted_at is null
      )
      update subjects s set canonical_subject_id = ranked.canonical_id
      from ranked where ranked.id = s.id and ranked.id <> ranked.canonical_id;
      create index subjects_canonical_subject_idx on subjects(canonical_subject_id);

      create table teaching_assignments (
        id uuid primary key default gen_random_uuid(),
        subject_id uuid not null references subjects(id),
        teacher_id uuid not null references users(id),
        class_id varchar(100) not null references classes(id),
        created_at timestamptz not null default now(),
        created_by uuid,
        updated_at timestamptz,
        updated_by uuid,
        deleted_at timestamptz,
        deleted_by uuid
      );
      create unique index teaching_assignments_active_unique
        on teaching_assignments(subject_id, teacher_id, class_id)
        where deleted_at is null;
      create index teaching_assignments_teacher_idx
        on teaching_assignments(teacher_id) where deleted_at is null;

      create table exam_target_classes (
        id uuid primary key default gen_random_uuid(),
        exam_id uuid not null references exams(id) on delete cascade,
        class_id varchar(100) not null references classes(id),
        created_at timestamptz not null default now(),
        created_by uuid,
        deleted_at timestamptz,
        deleted_by uuid
      );
      create unique index exam_target_classes_active_unique
        on exam_target_classes(exam_id, class_id)
        where deleted_at is null;
      create index exam_target_classes_class_idx
        on exam_target_classes(class_id) where deleted_at is null;

      alter table teaching_assignments enable row level security;
      alter table exam_target_classes enable row level security;
      revoke all on teaching_assignments, exam_target_classes from public, anon, authenticated;
      grant all on teaching_assignments, exam_target_classes to service_role;

      insert into teaching_assignments(subject_id, teacher_id, class_id, created_by)
      select coalesce(s.canonical_subject_id, s.id), s.teacher_id, s.class_id, null
      from subjects s
      join users u on u.id = s.teacher_id and u.deleted_at is null
      join classes c on c.id = s.class_id and c.deleted_at is null
      where s.deleted_at is null and s.teacher_id is not null and s.class_id is not null
      on conflict do nothing;

      insert into exam_target_classes(exam_id, class_id, created_by)
      select e.id, s.class_id, null
      from exams e
      join subjects s on s.id = e.subject_id
      join classes c on c.id = s.class_id and c.deleted_at is null
      where e.deleted_at is null and s.class_id is not null
      on conflict do nothing;
    `);
  }

  async down(runner: QueryRunner) {
    await runner.query(`
      drop table exam_target_classes;
      drop table teaching_assignments;
      drop index subjects_canonical_subject_idx;
      alter table subjects drop column canonical_subject_id;
    `);
  }
}
