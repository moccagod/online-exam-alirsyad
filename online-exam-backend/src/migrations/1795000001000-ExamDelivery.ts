import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExamDelivery1795000001000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(`
      alter table exams add column starts_at timestamptz, add column ends_at timestamptz,
        add column assigned_teacher_id uuid references users(id),
        add column package_exam_id uuid references exams(id),
        add check ((starts_at is null and ends_at is null) or
          (starts_at is not null and ends_at is not null and starts_at < ends_at));
      create view exam_teacher_assignments with (security_invoker=true) as
        select e.id,e.subject_id,coalesce(e.assigned_teacher_id,s.teacher_id) teacher_id
        from exams e join subjects s on s.id=e.subject_id where e.deleted_at is null and s.deleted_at is null;
      revoke all on exam_teacher_assignments from public,anon,authenticated;
      grant select on exam_teacher_assignments to service_role;
      create table exam_delivery (
        exam_id uuid primary key references exams(id), token text not null,
        questions jsonb, mc_weight integer, essay_weight integer
      );
      alter table exam_delivery enable row level security;
      revoke all on exam_delivery from public, anon, authenticated;
      grant all on exam_delivery to service_role;
      alter table exam_sessions add column revision bigint not null default 0,
        add column draft jsonb not null default '{}', add column managed boolean not null default false,
        add column events jsonb not null default '[]', add column needs_review boolean not null default false;
      create unique index managed_exam_attempt on exam_sessions(exam_id, student_id) where managed;

      create view exam_version_questions with (security_invoker=true) as
        select q.* from questionnaires q where not exists
          (select 1 from exam_delivery d where d.exam_id=q.exam_id and d.questions is not null)
        union all
        select q.* from exam_delivery d cross join lateral
          jsonb_populate_recordset(null::questionnaires, d.questions) q;
      revoke all on exam_version_questions from public, anon, authenticated;
      grant select on exam_version_questions to service_role;

      create table exam_score_history(id uuid primary key default gen_random_uuid(), submission_id uuid not null,
        old_score real not null, new_score real not null, operator_id uuid not null, changed_at timestamptz not null default now());
      alter table exam_score_history enable row level security;
      revoke all on exam_score_history from public,anon,authenticated;
      grant all on exam_score_history to service_role;
      create function exam_correct_scores(p_exam uuid,p_operator uuid,p_changes jsonb) returns void language plpgsql as $$
      declare item record;
      begin
        for item in select * from jsonb_to_recordset(p_changes) as x(id uuid,old real,proposed real) loop
          update exam_submissions set score=item.proposed,updated_at=now(),updated_by=p_operator
            where id=item.id and exam_id=p_exam and score=item.old;
          if not found then raise exception 'Nilai berubah. Muat ulang pratinjau'; end if;
          insert into exam_score_history(submission_id,old_score,new_score,operator_id)
            values(item.id,item.old,item.proposed,p_operator);
        end loop;
      end $$;
      revoke all on function exam_correct_scores(uuid,uuid,jsonb) from public,anon,authenticated;
      grant execute on function exam_correct_scores(uuid,uuid,jsonb) to service_role;
      create function exam_schedule(p_exam uuid, p_open timestamptz, p_close timestamptz, p_token text)
      returns void language plpgsql as $$
      begin
        perform 1 from exams where id=p_exam for update;
        if exists(select 1 from exam_submissions r where r.exam_id=p_exam) and not exists
          (select 1 from exam_delivery where exam_id=p_exam and questions is not null)
          then raise exception 'Gunakan sesi baru untuk hasil historis'; end if;
        if exists(select 1 from exam_delivery where exam_id=p_exam and questions is not null) and
          exists(select 1 from exams where id=p_exam and (starts_at<>p_open or ends_at<>p_close)) then
          raise exception 'Jadwal sesi yang sudah dibuka tidak dapat diubah';
        end if;
        update exams set starts_at=p_open,ends_at=p_close,date=(p_open at time zone 'Asia/Jakarta')::date,
          duration=ceil(extract(epoch from p_close-p_open)/60) where id=p_exam;
        insert into exam_delivery(exam_id,token) values(p_exam,p_token)
          on conflict(exam_id) do update set token=excluded.token;
      end $$;
      revoke all on function exam_schedule(uuid,timestamptz,timestamptz,text) from public,anon,authenticated;
      grant execute on function exam_schedule(uuid,timestamptz,timestamptz,text) to service_role;

      create function exam_freeze(p_exam uuid) returns void language plpgsql as $$
      declare e exams; items jsonb;
      begin
        select * into strict e from exams where id=p_exam;
        perform 1 from exam_delivery where exam_id=p_exam and questions is null for update;
        if not found then return; end if;
        select jsonb_agg(to_jsonb(q)||jsonb_build_object('exam_id',p_exam) order by q.index,q.id)
          into items from questionnaires q where exam_id=coalesce(e.package_exam_id,p_exam) and deleted_at is null;
        if items is not null then
          update exam_delivery set questions=items,mc_weight=e.multiple_choice_weight,essay_weight=e.essay_weight where exam_id=p_exam;
        end if;
      end $$;

      create function exam_freeze_before_edit() returns trigger language plpgsql as $$
      declare source uuid; target uuid;
      begin
        source=case when tg_op='DELETE' then old.exam_id else new.exam_id end;
        for target in select e.id from exams e join exam_delivery d on d.exam_id=e.id
          where coalesce(e.package_exam_id,e.id)=source and e.starts_at<=now() and d.questions is null
          order by e.id loop
          perform exam_freeze(target);
        end loop;
        if tg_op='DELETE' then return old; end if;
        return new;
      end $$;
      create trigger freeze_open_questions before insert or update or delete on questionnaires
        for each row execute function exam_freeze_before_edit();

      create function exam_protect_schedule() returns trigger language plpgsql as $$
      begin
        if old.starts_at<=now() and (old.assigned_teacher_id is distinct from new.assigned_teacher_id or old.package_exam_id is distinct from new.package_exam_id or
          old.multiple_choice_weight<>new.multiple_choice_weight or old.essay_weight<>new.essay_weight or old.subject_id<>new.subject_id)
          then raise exception 'Paket dan bobot sesi yang sudah dibuka tidak dapat diubah'; end if;
        return new;
      end $$;
      create trigger protect_open_schedule before update on exams for each row execute function exam_protect_schedule();
      revoke all on function exam_freeze(uuid), exam_freeze_before_edit(),exam_protect_schedule() from public,anon,authenticated;
      grant execute on function exam_freeze(uuid), exam_freeze_before_edit(),exam_protect_schedule() to service_role;
      create function exam_prepare(p_exam uuid, p_student uuid, p_token text, p_start boolean)
      returns jsonb language plpgsql as $$
      declare e exams; d exam_delivery; s exam_sessions; items jsonb;
      begin
        select * into e from exams where id=p_exam and deleted_at is null for share;
        if not exists(select 1 from exam_students a join users u on u.id=a.student_id
          where a.exam_id=p_exam and a.student_id=p_student and a.deleted_at is null
            and u.deleted_at is null and u.is_active and u.role='SISWA' and not u.must_change_password)
          then raise exception 'Anda bukan peserta sesi ini'; end if;
        if e.starts_at is null or now()<e.starts_at or now()>=e.ends_at then raise exception 'Di luar jadwal ujian'; end if;
        select * into strict d from exam_delivery where exam_id=p_exam for update;
        if clock_timestamp()>=e.ends_at then raise exception 'Waktu ujian selesai'; end if;
        select * into s from exam_sessions where exam_id=p_exam and student_id=p_student and managed;
        if s.id is null and d.token is distinct from p_token then raise exception 'Token ujian diperlukan'; end if;
        if s.finished or exists(select 1 from exam_submissions where exam_id=p_exam and student_id=p_student and answers::jsonb <> '[]'::jsonb)
          then raise exception 'Ujian sudah terkirim'; end if;
        if s.status='locked' then raise exception 'Sesi terkunci. Hubungi operator'; end if;
        if d.questions is null then
          perform exam_freeze(p_exam);
          select questions into d.questions from exam_delivery where exam_id=p_exam;
          if d.questions is null then raise exception 'Paket soal kosong'; end if;
        end if;
        if p_start and s.id is null then
          insert into exam_sessions(exam_id,student_id,managed) values(p_exam,p_student,true) returning * into s;
        end if;
        select jsonb_agg(jsonb_build_object('id',q->'id','index',q->'index','type',q->'type','question',q->'question','options',q->'options'))
          into items from jsonb_array_elements(d.questions) q;
        return jsonb_build_object('id',s.id,'questions',items,'draft',s.draft,'revision',s.revision,'ends_at',e.ends_at,
          'server_time',now(),'tab_switch_count',s.tab_switch_count);
      end $$;

      create function exam_attempt(p_session uuid, p_student uuid, p_action text, p_body jsonb)
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
              status=case when tab_switch_count>=2 then 'locked' else status end,
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
      create function exam_close_due() returns void language plpgsql as $$
      declare s record;
      begin
        for s in select a.id,a.student_id from exam_sessions a join exams e on e.id=a.exam_id
          where a.managed and not a.finished and e.ends_at<=now() limit 100 for update of a skip locked loop
          perform exam_attempt(s.id,s.student_id,'expire','{}');
        end loop;
      end $$;
      revoke all on function exam_prepare(uuid,uuid,text,boolean), exam_attempt(uuid,uuid,text,jsonb), exam_close_due() from public, anon, authenticated;
      grant execute on function exam_prepare(uuid,uuid,text,boolean), exam_attempt(uuid,uuid,text,jsonb), exam_close_due() to service_role;
    `);
  }

  async down(runner: QueryRunner) {
    await runner.query(`
      drop function exam_schedule(uuid,timestamptz,timestamptz,text), exam_close_due(), exam_attempt(uuid,uuid,text,jsonb), exam_prepare(uuid,uuid,text,boolean);
      drop function exam_correct_scores(uuid,uuid,jsonb);
      drop table exam_score_history;
      drop view exam_version_questions;
      drop index managed_exam_attempt;
      alter table exam_sessions drop column revision, drop column draft, drop column managed, drop column events, drop column needs_review;
      drop trigger freeze_open_questions on questionnaires;
      drop trigger protect_open_schedule on exams;
      drop function exam_freeze_before_edit(),exam_protect_schedule(),exam_freeze(uuid);
      drop view exam_teacher_assignments;
      drop table exam_delivery;
      alter table exams drop column starts_at, drop column ends_at, drop column package_exam_id, drop column assigned_teacher_id;
    `);
  }
}
