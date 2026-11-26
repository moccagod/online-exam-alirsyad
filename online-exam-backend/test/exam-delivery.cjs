const { PGlite } = require('@electric-sql/pglite');
const assert = require('node:assert/strict');
const uuid = require('crypto').randomUUID;
(async () => {
  const db = await PGlite.create();
  const query = async (sql, args = []) => (await db.query(sql, args)).rows;
  const migration = async (name) => {
    const M = Object.values(
      require(__dirname + '/../dist/src/migrations/' + name),
    )[0];
    await new M().up({ query: (sql) => db.exec(sql) });
  };
  await db.exec(
    "create role anon;create role authenticated;create role service_role;create function uuid_generate_v4() returns uuid language sql as 'select gen_random_uuid()'",
  );
  await migration('1700000000000-InitialMigration');
  await migration('1711023456789-create-exam-students');
  await migration('1764651000000-ensure-subjects-teacher-relationship');
  await migration('1768000000000-ensure-exam-sessions-columns');
  await migration('1768100000000-add-exam-score-weights');
  await db.exec(
    'alter table exam_submissions add column session_id uuid,add column created_by uuid,add column updated_at timestamp,add column updated_by uuid;create unique index uq_result on exam_submissions(exam_id,student_id)',
  );
  await migration('1768300000000-create-exam-submission-jobs');
  await migration('1795000000000-ExamAccounts');
  await migration('1795000001000-ExamDelivery');
  const teacher = uuid(),
    course = uuid(),
    otherCourse = uuid(),
    exam = uuid(),
    next = uuid(),
    q = uuid(),
    students = [uuid(), uuid(), uuid()];
  for (const id of [teacher, ...students])
    await query(
      "insert into users(id,name,userid,role,class_name,nisn,gender,description,created_by) values($1::uuid,'test',$1::uuid::text,'SISWA','AK','','L','','test')",
      [id],
    );
  await query(
    "insert into subjects(id,name,class_id,created_by) values($1,'TIK','AK','test')",
    [course],
  );
  await query(
    "insert into subjects(id,name,class_id,created_by) values($1,'TIK','TKJ','test')",
    [otherCourse],
  );
  for (const id of [exam, next]) {
    await query(
      "insert into exams(id,title,date,type,duration,subject_id,created_by) values($1,'test',now(),'REGULER',90,$2,'test')",
      [id, id === exam ? course : otherCourse],
    );
    for (const st of students)
      await query(
        'insert into exam_students(exam_id,student_id) values($1,$2)',
        [id, st],
      );
  }
  await query(
    "insert into questionnaires(id,exam_id,question,type,answer,created_by) values($1,$2,'original','multiple_choice','A','test')",
    [q, exam],
  );
  await query('update exams set package_exam_id=$1 where id=$2', [exam, next]);
  const prep = async (e, st, token, start = false) =>
    (
      await query('select exam_prepare($1,$2,$3,$4) data', [
        e,
        st,
        token,
        start,
      ])
    )[0].data;
  const act = async (id, student, action, body = {}) =>
    (
      await query('select exam_attempt($1,$2,$3,$4) data', [
        id,
        student,
        action,
        JSON.stringify(body),
      ])
    )[0].data;
  await query(
    "select exam_schedule($1,now()+interval '1 hour',now()+interval '2 hours','AK')",
    [exam],
  );
  await assert.rejects(prep(exam, students[0], 'AK'));
  for (const [e, k] of [
    [exam, 'AK'],
    [next, 'TKJ'],
  ])
    await query(
      "select exam_schedule($1,now()-interval '15 minutes',now()+interval '75 minutes',$2)",
      [e, k],
    );
  await assert.rejects(prep(exam, teacher, 'AK'));
  await assert.rejects(prep(exam, students[0], 'wrong'));
  const preview = await prep(exam, students[0], 'AK');
  assert.equal(preview.id, null);
  assert.equal(preview.questions[0].answer, undefined);
  const sessions = [
    await prep(exam, students[0], 'AK', true),
    await prep(exam, students[1], 'AK', true),
  ];
  assert.equal(
    (await query('select count(*)::int as total from exam_sessions'))[0].total,
    2,
  );
  await query("update questionnaires set question='revised' where id=$1", [q]);
  assert.equal(
    (await prep(exam, students[0], '')).questions[0].question,
    'original',
  );
  assert.equal(
    (await prep(next, students[0], 'TKJ')).questions[0].question,
    'original',
  );
  await query(
    "select exam_schedule(id,starts_at,ends_at,'ROTATED') from exams where id=$1",
    [exam],
  );
  await assert.rejects(prep(exam, students[2], 'AK', true));
  const blank = await prep(exam, students[2], 'ROTATED', true);
  const blankReceipt = await act(blank.id, students[2], 'submit', {
    revision: 0,
    draft: {},
  });
  assert(blankReceipt.id);
  const sid = sessions[0].id;
  const st = students[0];
  await act(sid, st, 'draft', { revision: 2, draft: { [q]: 'A' } });
  await act(sid, st, 'draft', { revision: 1, draft: { [q]: 'B' } });
  assert.equal((await prep(exam, st, '')).draft[q], 'A');
  for (const e of ['one', 'one', 'two', 'three'])
    await act(sid, st, 'violation', { event: e });
  await assert.rejects(act(sid, st, 'draft', { revision: 3, draft: {} }));
  await act(sid, st, 'unlock');
  assert.equal((await prep(exam, st, '')).tab_switch_count, 0);
  await assert.rejects(act(sid, teacher, 'submit', { revision: 2, draft: {} }));
  const receipts = await Promise.all(
    Array.from({ length: 20 }, () =>
      act(sid, st, 'submit', { revision: 2, draft: { [q]: 'A' } }),
    ),
  );
  assert.equal(new Set(receipts.map((r) => r.id)).size, 1);
  await query(
    "update exams set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 minute' where id=$1",
    [exam],
  );
  await query('select exam_close_due()');
  assert.equal((await query('select * from exam_submissions')).length, 3);
  assert.equal((await query('select * from exam_submission_jobs')).length, 3);
  await query('update exam_submissions set score=99 where id=$1', [
    receipts[0].id,
  ]);
  await query('select exam_correct_scores($1,$2,$3)', [
    exam,
    teacher,
    JSON.stringify([{ id: receipts[0].id, old: 99, proposed: 22 }]),
  ]);
  assert.equal(
    (await query('select new_score from exam_score_history'))[0].new_score,
    22,
  );
  const { grade } = require(__dirname + '/../dist/src/exams/grade');
  const qs = Array.from({ length: 45 }, (_, id) => ({
    id,
    type: 'multiple_choice',
    answer: 'A',
  }));
  const weights = { mc_weight: 60, essay_weight: 40 };
  for (const [count, value] of [
    [10, 22],
    [0, 0],
    [45, 100],
  ])
    assert.equal(
      grade(
        qs,
        qs.slice(0, count).map((q) => ({ question_id: q.id, answer: 'A' })),
        weights,
      ).totalScore,
      value,
    );
  assert.equal(
    grade(
      [qs[0], { id: 50, type: 'essay' }],
      [{ question_id: 0, answer: 'A' }],
      weights,
    ).totalScore,
    60,
  );
  assert.equal(
    grade(
      [{ id: 50, type: 'essay' }],
      [{ question_id: 50, answer: 'example' }],
      weights,
    ).totalScore,
    null,
  );
  console.log(
    'Synthetic migrations, access window, shared package, revision ordering, lock, duplicate submissions, expiry and grading passed',
  );
  await db.close();
  const XLSX = require('xlsx');
  const {
    QuestionnaireService,
  } = require('../dist/src/questionnaires/questionnaire.service');
  const rows = new Map();
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { package_exam_id: null } }),
        }),
      }),
      upsert: async (batch) => {
        for (const row of batch) rows.set(row.id, row);
        return {};
      },
    }),
  };
  const service = new QuestionnaireService(supabase);
  const makeFile = (key) => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['Tipe', 'Pertanyaan', 'A', 'B', 'C', 'D', 'E', 'Kunci'],
        ['PG', '2 + 3?', '3', '5', '', '', '', key],
        [],
        ['Esai', 'Jelaskan jawabannya', '', '', '', '', '', 'Panduan'],
      ]),
      'Soal',
    );
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  };
  const admin = { sub: teacher, role: 'ADMIN' };
  const invalid = await service.importWorkbook(
    exam,
    admin,
    makeFile('C'),
    true,
  );
  assert.match(invalid.errors[0], /Baris 2/);
  assert.equal(rows.size, 0);
  const valid = await service.importWorkbook(exam, admin, makeFile('B'), false);
  assert.deepEqual(valid.errors, []);
  assert.equal(valid.rows[1].index, 4);
  assert.equal(rows.size, 0);
  await service.importWorkbook(exam, admin, makeFile('B'), true);
  await service.importWorkbook(exam, admin, makeFile('B'), true);
  assert.equal(rows.size, 2);
  console.log('Excel preview, validation and retry passed');
})().catch((e) => {
  console.error(e.message, e.where);
  process.exit(1);
});
