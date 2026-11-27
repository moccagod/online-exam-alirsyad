import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class ExamStudentsService {
  constructor(private readonly supabase: SupabaseClient) {}

  private normalizeClass(value: unknown) {
    return String(value ?? '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  }

  async syncClassStudents(examId: string, createdBy: string) {
    const { data: exam, error: examError } = await this.supabase.from('exams')
      .select('id,subject:subjects(class_id),targets:exam_target_classes(class_id)')
      .eq('id', examId).is('deleted_at', null).maybeSingle();
    if (examError) throw new InternalServerErrorException(examError.message);
    if (!exam) throw new BadRequestException('Ujian tidak ditemukan.');
    const subject: any = Array.isArray(exam.subject) ? exam.subject[0] : exam.subject;
    const classIds = (exam.targets || []).map((target: any) => target.class_id);
    if (classIds.length === 0 && subject?.class_id) classIds.push(subject.class_id);
    if (classIds.length === 0) throw new BadRequestException('Kelas target ujian belum ditentukan.');
    return this.enrollClassStudents(examId, classIds, createdBy);
  }

  async enrollClassStudents(examId: string, classIds: string[], createdBy: string) {
    const { data: classes, error: classesError } = await this.supabase.from('classes')
      .select('id,name').in('id', classIds).is('deleted_at', null);
    if (classesError) throw new InternalServerErrorException(classesError.message);
    if (!classes?.length) throw new BadRequestException('Kelas target ujian tidak tersedia.');
    const identifiers = new Set(classes.flatMap((row) => [row.id, row.name])
      .map((value) => this.normalizeClass(value)).filter(Boolean));

    const students: { id: string; class_id: string | null; class_name: string | null }[] = [];
    for (let from = 0; ; from += 500) {
      const { data, error } = await this.supabase.from('users')
        .select('id,class_id,class_name').eq('role', 'SISWA').eq('is_active', true)
        .is('deleted_at', null).order('id').range(from, from + 499);
      if (error) throw new InternalServerErrorException(error.message);
      students.push(...(data || []));
      if ((data || []).length < 500) break;
    }
    const matched = new Set(students.filter((student) =>
      [student.class_id, student.class_name].some((value) => identifiers.has(this.normalizeClass(value))),
    ).map((student) => student.id));

    const existing = new Map<string, { id: string; deleted_at: string | null }>();
    for (let from = 0; ; from += 500) {
      const { data, error } = await this.supabase.from('exam_students')
        .select('id,student_id,deleted_at').eq('exam_id', examId).order('id').range(from, from + 499);
      if (error) throw new InternalServerErrorException(error.message);
      for (const row of data || []) existing.set(row.student_id, row);
      if ((data || []).length < 500) break;
    }

    const toInsert = [...matched].filter((id) => !existing.has(id));
    const toRestore = [...matched].filter((id) => existing.get(id)?.deleted_at);
    for (let offset = 0; offset < toInsert.length; offset += 500) {
      const { error } = await this.supabase.from('exam_students').insert(
        toInsert.slice(offset, offset + 500).map((studentId) => ({ exam_id: examId, student_id: studentId, created_by: createdBy })),
      );
      if (error) throw new InternalServerErrorException(error.message);
    }
    for (const studentId of toRestore) {
      const { error } = await this.supabase.from('exam_students')
        .update({ deleted_at: null, deleted_by: null }).eq('id', existing.get(studentId)!.id);
      if (error) throw new InternalServerErrorException(error.message);
    }
    return { added: toInsert.length + toRestore.length, total: matched.size };
  }

  /* -------------------------------------------------------
   * GET EXAM STUDENTS
   * -----------------------------------------------------*/
  async getExamStudents(examId: string, page?: number, limit?: number) {
    if (!examId) throw new Error('examId wajib diisi');

    let query = this.supabase
      .from('exam_students')
      .select(`
        *,
        student:users (id,name,userid,class_id,class_name)
      `, { count: 'exact' })
      .eq('exam_id', examId)
      .is('deleted_at', null).order('id');

    if (page !== undefined && limit !== undefined) {
      query = query.range((page - 1) * limit, page * limit - 1);
    }
    const { data, error, count } = await query;

    if (error) throw new InternalServerErrorException(error.message);
    return page !== undefined ? { data, total: count || 0, page, limit } : data;
  }

  /* -------------------------------------------------------
   * ASSIGN STUDENTS (INSERT + RESTORE + SOFT-DELETE)
   * -----------------------------------------------------*/
  async assignStudents(examId: string, studentIds: string[], createdBy: string) {
    if (!examId) throw new Error('examId wajib diisi');
    if (!Array.isArray(studentIds)) studentIds = [];

    const uniqStudentIds = Array.from(new Set(studentIds.map((s) => String(s))));

    if (uniqStudentIds.length > 0) {
      const [{ data: targets, error: targetError }, { data: selected, error: studentError }, { data: exam }] = await Promise.all([
        this.supabase.from('exam_target_classes').select('class_id,class:classes(id,name)').eq('exam_id', examId).is('deleted_at', null),
        this.supabase.from('users').select('id,class_id,class_name').in('id', uniqStudentIds).eq('role', 'SISWA').eq('is_active', true).is('deleted_at', null),
        this.supabase.from('exams').select('subject:subjects(class_id)').eq('id', examId).maybeSingle(),
      ]);
      if (targetError || studentError) throw new InternalServerErrorException(targetError?.message || studentError?.message);
      const allowedClasses = new Set((targets || []).flatMap((target: any) => {
        const classRow = Array.isArray(target.class) ? target.class[0] : target.class;
        return [target.class_id, classRow?.id, classRow?.name].map((value) => this.normalizeClass(value));
      }).filter(Boolean));
      if (allowedClasses.size === 0) {
        const subject: any = Array.isArray(exam?.subject) ? exam.subject[0] : exam?.subject;
        if (subject?.class_id) allowedClasses.add(this.normalizeClass(subject.class_id));
      }
      const validStudents = (selected || []).filter((student) =>
        [student.class_id, student.class_name].some((value) => allowedClasses.has(this.normalizeClass(value))),
      );
      if (validStudents.length !== uniqStudentIds.length) {
        throw new BadRequestException('Peserta harus siswa aktif dari kelas target ujian.');
      }
    }

    /* ======================================================
     * 1. Get ALL existing rows (INCLUDING deleted)
     * ====================================================*/
    const { data: existingAll, error: getErr } = await this.supabase
      .from('exam_students')
      .select('*')
      .eq('exam_id', examId); // supabase already returns soft-deleted

    if (getErr) throw new InternalServerErrorException(getErr.message);

    const existingByStudent = new Map(existingAll.map((e) => [String(e.student_id), e]));
    const existingActive = existingAll.filter((e) => !e.deleted_at);

    /* ======================================================
     * 2. INSERT NEW STUDENTS
     * ====================================================*/
    const toInsert = uniqStudentIds.filter((id) => !existingByStudent.has(id));

    if (toInsert.length > 0) {
      const insertPayload = toInsert.map((sid) => ({
        exam_id: examId,
        student_id: sid,
        created_by: createdBy,
      }));

      const { error: insertErr } = await this.supabase
        .from('exam_students')
        .insert(insertPayload);

      if (insertErr) throw new InternalServerErrorException(insertErr.message);
    }

    /* ======================================================
     * 3. RESTORE SOFT-DELETED
     * ====================================================*/
    const toRestore = existingAll.filter(
      (e) => e.deleted_at && uniqStudentIds.includes(String(e.student_id)),
    );

    for (const row of toRestore) {
      const { error: restoreErr } = await this.supabase
        .from('exam_students')
        .update({
          deleted_at: null,
          deleted_by: null,
        })
        .eq('id', row.id);

      if (restoreErr) throw new InternalServerErrorException(restoreErr.message);
    }

    /* ======================================================
     * 4. SOFT DELETE REMOVED STUDENTS
     * ====================================================*/
    const toSoftDelete = existingActive.filter(
      (e) => !uniqStudentIds.includes(String(e.student_id)),
    );

    for (const row of toSoftDelete) {
      const { error: delErr } = await this.supabase
        .from('exam_students')
        .update({
          deleted_at: new Date(),
          deleted_by: createdBy,
        })
        .eq('id', row.id);

      if (delErr) throw new InternalServerErrorException(delErr.message);
    }

    /* ======================================================
     * 5. RETURN FRESH ACTIVE LIST
     * ====================================================*/
    const { data: finalList, error: listErr } = await this.supabase
      .from('exam_students')
      .select(`
        *,
        student:users (*)
      `)
      .eq('exam_id', examId)
      .is('deleted_at', null);

    if (listErr) throw new InternalServerErrorException(listErr.message);

    return finalList;
  }
}
