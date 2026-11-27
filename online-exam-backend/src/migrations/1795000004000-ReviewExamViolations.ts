import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReviewExamViolations1795000004000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      create or replace function exam_attempt(p_session uuid, p_student uuid, p_action text, p_body jsonb)
      returns jsonb language plpgsql as $$
      declare s exam_sessions; deadline timestamptz; received_at timestamptz; receipt uuid; normalized jsonb; rev bigint;
      begin
        select * into strict s from exam_sessions where id=p_session and student_id=p_student and managed for update;
        received_at=clock_timestamp();
        select ends_at into deadline from exams where id=s.exam_id;
        if p_action not in ('review','expire','unlock') and not exists
          (select 1 from exam_students where exam_id=s.exam_id and student_id=p_student and deleted_at is null)
          then raise exception 'Anda bukan peserta sesi ini'; end if;
        if p_action='review' then
          update exam_sessions set needs_review=true where id=s.id and coalesce((p_body->>'revision')::bigint,s.revision+1)>s.revision;
          return '{}'::jsonb;
        end if;
        if p_action='submit' or p_action='expire' then
          select id into receipt from exam_submissions where session_id=s.id;
          if receipt is not null and s.finished then
            if coalesce((p_body->>'revision')::bigint,0)>s.revision then
              update exam_sessions set needs_review=true where id=s.id;
            end if;
            return jsonb_build_object('id',receipt,'revision',s.revision); end if;
        end if;
        if s.finished then raise exception 'Ujian sudah selesai'; end if;
        if p_action='expire' and received_at<deadline then raise exception 'Ujian masih dibuka'; end if;
        if received_at>=deadline and p_action not in ('expire','submit') then raise exception 'Waktu ujian selesai'; end if;
        if s.status='locked' and p_action='violation' then
          return jsonb_build_object('count',s.tab_switch_count,'status',s.status);
        end if;
        if s.status='locked' and p_action not in ('unlock','expire') then raise exception 'Sesi terkunci'; end if;
        if p_action='unlock' then
          update exam_sessions set status='started',tab_switch_count=0,events=events||jsonb_build_array(jsonb_build_object('unlock',now())) where id=s.id;
        elsif p_action='violation' then
          if not s.events @> jsonb_build_array(jsonb_build_object('event',p_body->>'event')) then
            update exam_sessions set tab_switch_count=tab_switch_count+1,
              events=events||jsonb_build_array(jsonb_build_object('event',p_body->>'event','at',now())) where id=s.id returning * into s;
          end if;
        elsif p_action in ('draft','submit','expire') then
          rev=(p_body->>'revision')::bigint;
          if p_action<>'expire' and received_at<deadline and rev=s.revision and p_body->'draft'<>s.draft then
            raise exception 'Draf berbeda pada revisi yang sama. Muat ulang sebelum mengirim.';
          end if;
          if p_action<>'expire' and received_at<deadline and rev>s.revision then
            if jsonb_typeof(p_body->'draft') is distinct from 'object' then raise exception 'Format draf salah'; end if;
            update exam_sessions set draft=p_body->'draft',revision=rev where id=s.id returning * into s;
          end if;
          if p_action in ('expire','submit') then
            select jsonb_agg(jsonb_build_object('question_id',q->>'id','answer',coalesce(s.draft->>(q->>'id'),'')))
              into normalized from exam_delivery d cross join lateral jsonb_array_elements(d.questions) q where exam_id=s.exam_id;
            insert into exam_submissions(exam_id,student_id,session_id,answers,created_by)
              values(s.exam_id,s.student_id,s.id,normalized,s.student_id)
              returning id into receipt;
            insert into exam_submission_jobs(type,submission_id,exam_id,session_id,answers,updated_by)
              values('score_exam_submission',receipt,s.exam_id,s.id,normalized,s.student_id);
            update exam_sessions set finished=true,status='finished',finished_at=now(),
              needs_review=needs_review or coalesce(rev>s.revision,false),
              finished_reason=case when received_at>=deadline then 'deadline' else 'submitted' end where id=s.id;
          end if;
        else raise exception 'Aksi tidak dikenal';
        end if;
        return jsonb_build_object('id',receipt,'revision',s.revision,'count',s.tab_switch_count,'status',s.status);
      end $$;
    `);
  }

  public async down(): Promise<void> {
    throw new Error('Aturan pelanggaran lama tidak boleh dipulihkan melalui migration:revert.');
  }
}
