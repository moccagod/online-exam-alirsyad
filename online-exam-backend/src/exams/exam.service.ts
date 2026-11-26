import {assignedExams} from './teacher-assignments';
import { grade, gradingWeights } from "./grade";
import { randomBytes } from "crypto";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import type { Exam } from './entities/exam.entity';
import type { Questionnaire } from '../questionnaires/entities/questionnaire.entity';
import { CreateExamDto } from './dto/create-exam.dto';
import { UpdateExamDto } from './dto/update-exam.dto';

@Injectable()
export class ExamService {
  constructor(private readonly supabase: SupabaseClient) {}

  async recalculate(id: string, operator: string, expected?: any[]) {
    const [history, result, archive, weights] = await Promise.all([
      this.supabase.from('exam_version_questions').select('*').eq('exam_id',id),
      this.supabase.from('exam_submissions').select('id,student_id,created_at,answers,score,student:users(name)').eq('exam_id',id).order('id'),
      this.supabase.from('exam_delivery').select('mc_weight').eq('exam_id',id).maybeSingle(),
      gradingWeights(this.supabase,id)
    ]);
    for (const response of [history,result,archive]) if(response.error) throw new InternalServerErrorException(response.error.message);
    const all = history.data || [];
    const changes: {id:string; student:unknown; old:number; proposed:number|null}[] = [];
    for (const row of result.data || []) {
      if (row.score==null) continue;
      const uncertain = archive.data?.mc_weight == null && (!all.length || all.some(q=>
        [q.created_at,q.updated_at,q.deleted_at].some(at=>at && Date.parse(at)>Date.parse(row.created_at))) ||
        !Array.isArray(row.answers) || row.answers.some(a=>!all.some(q=>q.id===a.question_id)) ||
        all.some(q=>q.type==='essay'));
      const proposed = uncertain ? null : grade(all.filter(q=>!q.deleted_at),row.answers,weights).totalScore;
      const student = Array.isArray(row.student) ? row.student[0] : row.student;
      changes.push({id:row.id,student,old:row.score,proposed});
    }
    const affected = changes.filter(c=>c.proposed!==null && c.proposed!==c.old);
    if (expected) {
      if (JSON.stringify(expected)!==JSON.stringify(affected.map(({id,old,proposed})=>({id,old,proposed})))) {
        throw new BadRequestException('Nilai berubah. Buka pratinjau kembali.');
      }
      const {error} = await this.supabase.rpc('exam_correct_scores',{p_exam:id,p_operator:operator,p_changes:expected});
      if (error) throw new BadRequestException(error.message);
    }
    return {changes,affected:affected.length};
  }

  async control(id: string) {
    const {data: config,error} = await this.supabase.from('exam_delivery').select('token').eq('exam_id',id).maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    const attempts = await this.supabase.from('exam_sessions')
      .select('id,status,events,needs_review,student:users(name,userid)').eq('exam_id',id).eq('managed',true);
    if (attempts.error) throw new InternalServerErrorException(attempts.error.message);
    return { token: config?.token, attempts: attempts.data };
  }

  async assignTeacher(id: string, teacher: string) {
    const {data} = await this.supabase.from('users').select('id').eq('id',teacher).eq('role','GURU').is('deleted_at',null).single();
    if (!data) throw new BadRequestException('Guru tidak tersedia');
    const {error} = await this.supabase.from('exams').update({assigned_teacher_id:teacher,package_exam_id:null}).eq('id',id);
    if (error) throw new BadRequestException(error.message);
    return {teacher};
  }

  async schedule(id: string, body: any) {
    if (!(Date.parse(body.ends_at) > Date.parse(body.starts_at))) throw new BadRequestException('Periksa jam mulai dan selesai');
    const token = randomBytes(6).toString('hex').toUpperCase();
    const {error} = await this.supabase.rpc('exam_schedule',{p_exam:id,p_open:body.starts_at,p_close:body.ends_at,p_token:token});
    if (error) throw new BadRequestException(error.message);
    return {token};
  }

  async unlock(id: string, session: string) {
    const row = await this.supabase.from('exam_sessions').select('student_id').eq('id',session).eq('exam_id',id).single();
    if (!row.data) throw new NotFoundException();
    const {error} = await this.supabase.rpc('exam_attempt',{p_session:session,p_student:row.data.student_id,p_action:'unlock',p_body:{}});
    if (error) throw new BadRequestException(error.message);
    return {success:true};
  }

  private normalizeExamDate(date: string | Date): string {
    const raw = String(date ?? '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00`;
    return raw;
  }

  private normalizeClassIdentifier(value: unknown): string {
    return String(value ?? '')
      .trim()
      .toUpperCase()
      .replace(/[\s_-]+/g, '');
  }

  private getDatePart(value: unknown): string {
    return String(value ?? '').trim().slice(0, 10);
  }

  private hasSubmittedAnswers(value: unknown): boolean {
    if (Array.isArray(value)) {
      return value.some((answer) => {
        if (!answer || typeof answer !== 'object') return false;
        if (!('question_id' in answer)) return false;
        if (!('answer' in answer)) return false;
        return answer.answer !== undefined && answer.answer !== null;
      });
    }

    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return this.hasSubmittedAnswers(parsed);
      } catch {
        return value.trim().length > 0;
      }
    }

    return Boolean(value && typeof value === 'object' && Object.keys(value as object).length > 0);
  }

  private normalizeScoreWeights(
    multipleChoiceWeight?: unknown,
    essayWeight?: unknown,
    fallback = { multiple_choice_weight: 50, essay_weight: 50 },
  ) {
    const mcWeight = Number(multipleChoiceWeight);
    const esWeight = Number(essayWeight);

    if (
      Number.isInteger(mcWeight) &&
      Number.isInteger(esWeight) &&
      mcWeight >= 0 &&
      esWeight >= 0 &&
      mcWeight <= 100 &&
      esWeight <= 100 &&
      mcWeight + esWeight === 100
    ) {
      return {
        multiple_choice_weight: mcWeight,
        essay_weight: esWeight,
      };
    }

    return fallback;
  }

  private isMissingExamWeightColumn(error: any): boolean {
    const message = String(`${error?.message || ''} ${error?.details || ''}`).toLowerCase();
    return (
      (message.includes('essay_weight') || message.includes('multiple_choice_weight')) &&
      (message.includes('schema cache') || message.includes('could not find'))
    );
  }

  private omitExamWeightColumns<T extends Record<string, any>>(payload: T) {
    const { multiple_choice_weight, essay_weight, ...rest } = payload;
    return rest;
  }

  private sortExamRows(exams: any[], sort: string, order: 'asc' | 'desc'): any[] {
    const direction = order === 'asc' ? 1 : -1;

    return exams.sort((left, right) => {
      const leftValue = left?.[sort];
      const rightValue = right?.[sort];

      if (leftValue == null && rightValue == null) return 0;
      if (leftValue == null) return -1 * direction;
      if (rightValue == null) return 1 * direction;

      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        return (leftValue - rightValue) * direction;
      }

      return String(leftValue).localeCompare(String(rightValue), 'id', {
        numeric: true,
        sensitivity: 'base',
      }) * direction;
    });
  }

  private getRole(user?: any): string {
    return String(user?.role || '').toUpperCase();
  }

  private async getExamWithSubject(examId: string) {
    const { data, error } = await this.supabase
      .from('exams')
      .select('*, subject:subjects(id,name,class_id,teacher_id)')
      .eq('id', examId)
      .is('deleted_at', null)
      .single();

    if (error || !data) throw new NotFoundException(`Exam ${examId} not found`);
    return data;
  }

  async assertCanAccessExam(examId: string, user?: any) {
    const role = this.getRole(user);
    const exam = await this.getExamWithSubject(examId);
    const subject = Array.isArray(exam.subject) ? exam.subject[0] : exam.subject;

    if (role === 'ADMIN') return exam;

    if (role === 'GURU') {
      if ((exam.assigned_teacher_id ?? subject?.teacher_id) === user?.sub) return exam;
      throw new ForbiddenException('Anda tidak memiliki akses ke ujian ini');
    }

    if (role === 'SISWA') {
      const {data,error} = await this.supabase.from('exam_students').select('id')
        .eq('student_id',user.sub).eq('exam_id',examId).is('deleted_at',null).limit(1).maybeSingle();
      if (!error && data) return exam;
      throw new ForbiddenException('Ujian ini tidak tersedia untuk kelas Anda');
    }

    throw new ForbiddenException('Role tidak memiliki akses ke ujian ini');
  }

  async create(dto: CreateExamDto, user?: any): Promise<Exam> {
    // Supabase row type untuk tabel exams
    type ExamRow = {
      id?: string;
      date: string;           // Supabase pakai string ISO untuk timestamp
      title: string;
      subject_id: string;
      type: string;
      duration: number;
      multiple_choice_weight: number;
      essay_weight: number;
      notes?: string | null;
      created_by: string;
      deleted_at?: string | null;
      deleted_by?: string | null;
    };

    if (this.getRole(user) === 'GURU') {
      const { data: subject, error: subjectError } = await this.supabase
        .from('subjects')
        .select('id, teacher_id')
        .eq('id', dto.subject_id)
        .is('deleted_at', null)
        .single();

      if (subjectError || !subject) throw new NotFoundException('Mata pelajaran tidak ditemukan');
      if (subject.teacher_id !== user?.sub) {
        throw new ForbiddenException('Guru hanya dapat membuat ujian untuk mata pelajaran yang diampu');
      }
    }

    const payload = {
      ...dto,
      date: this.normalizeExamDate(dto.date),
      ...this.normalizeScoreWeights(dto.multiple_choice_weight, dto.essay_weight),
      notes: dto.notes ?? null,
    } as ExamRow;

    const { data, error } = await this.supabase
    .from('exams') // string literal nama tabel
    .insert([payload] as ExamRow[]) // paksa ke ExamRow[]
    .select('*')
    .single();

  if (error) {
    if (this.isMissingExamWeightColumn(error)) {
      console.error(
        'Kolom bobot nilai exam belum tersedia di schema cache. Jalankan migration AddExamScoreWeights1768100000000 di VPS.',
      );

      const { data: fallbackData, error: fallbackError } = await this.supabase
        .from('exams')
        .insert([this.omitExamWeightColumns(payload)])
        .select('*')
        .single();

      if (fallbackError) throw new InternalServerErrorException(fallbackError.message);
      return fallbackData;
    }

    throw new InternalServerErrorException(error.message);
  }
  return data;
}


  async getDataWithPagination(
    search: string,
    sort: string,
    order: 'asc' | 'desc',
    page: number,
    limit: number,
    user?: any,
  ): Promise<{ data: Exam[]; meta: { total: number; page: number; limit: number; totalPages: number } }> {
    const offset = (page - 1) * limit;

    let query = this.supabase
      .from('exams')
      .select('*, subject:subjects(id,name,class_id,teacher_id)', { count: 'exact' })
      .is('deleted_at', null);

    if (search.trim()) {
      query = query.or(`title.ilike.%${search}%,type.ilike.%${search}%`);
    }

    if (String(user?.role || '').toUpperCase() === 'GURU') {
      const subjectIds = (await assignedExams(this.supabase,user.sub)).map(e=>e.id);
      if (subjectIds.length === 0) {
        return {
          data: [],
          meta: { total: 0, page, limit, totalPages: 0 },
        };
      }

      query = query.in('id', subjectIds);
    }

    const { data, count, error } = await query
      .order(sort, { ascending: order === 'asc' })
      .range(offset, offset + limit - 1);

    if (error) throw new InternalServerErrorException(error.message);

    return {
      data: data || [],
      meta: {
        total: count ?? 0,
        page,
        limit,
        totalPages: Math.ceil((count ?? 0) / limit),
      },
    };
  }

  async findById(id: string, user?: any): Promise<Exam | null> {
  // helper untuk map row Supabase ke entity Exam
    function mapExamRow(row: any): Exam {
      return {
        ...row,
        date: row.date,              // tetap string sesuai entity
        notes: row.notes ?? null,    // nullable
        created_at: row.created_at,
        updated_at: row.updated_at ?? null,
        deleted_at: row.deleted_at ?? null,
        deleted_by: row.deleted_by ?? null,
        updated_by: row.updated_by ?? null,
      };
    }

    return {...mapExamRow(await this.assertCanAccessExam(id, user)), server_time:new Date().toISOString()} as Exam;
  }

  async update(id: string, dto: UpdateExamDto, user?: any): Promise<Exam> {
    // Ambil dulu row lama
    const oldData = await this.assertCanAccessExam(id, user);

    if (this.getRole(user) === 'GURU' && dto.subject_id && dto.subject_id !== oldData.subject_id) {
      const { data: subject, error: subjectError } = await this.supabase
        .from('subjects')
        .select('id, teacher_id')
        .eq('id', dto.subject_id)
        .is('deleted_at', null)
        .single();

      if (subjectError || !subject) throw new NotFoundException('Mata pelajaran tidak ditemukan');
      if (subject.teacher_id !== user?.sub) {
        throw new ForbiddenException('Guru hanya dapat memilih mata pelajaran yang diampu');
      }
    }

    const scoreWeights = this.normalizeScoreWeights(
      dto.multiple_choice_weight,
      dto.essay_weight,
      {
        multiple_choice_weight: oldData.multiple_choice_weight ?? 50,
        essay_weight: oldData.essay_weight ?? 50,
      },
    );

    const updatedRow = {
      title: dto.title ?? oldData.title,
      subject_id: dto.subject_id ?? oldData.subject_id,
      type: dto.type ?? oldData.type,
      duration: dto.duration ?? oldData.duration,
      ...scoreWeights,
      notes: dto.notes ?? oldData.notes ?? null,
      date: dto.date ? this.normalizeExamDate(dto.date) : oldData.date,
      updated_by: (dto as any).updated_by ?? oldData.updated_by ?? null,
      updated_at: new Date(),
    };

    // Update di Supabase
    const { data: newData, error: updateError } = await this.supabase
      .from('exams')
      .update(updatedRow)
      .eq('id', id)
      .select()
      .single();

    if (updateError || !newData) {
      if (updateError && this.isMissingExamWeightColumn(updateError)) {
        console.error(
          'Kolom bobot nilai exam belum tersedia di schema cache. Jalankan migration AddExamScoreWeights1768100000000 di VPS.',
        );

        const { data: fallbackData, error: fallbackUpdateError } = await this.supabase
          .from('exams')
          .update(this.omitExamWeightColumns(updatedRow))
          .eq('id', id)
          .select()
          .single();

        if (fallbackUpdateError || !fallbackData) {
          throw new InternalServerErrorException(fallbackUpdateError?.message || 'Failed to update exam');
        }

        return mapExamRow(fallbackData);
      }

      throw new InternalServerErrorException(updateError?.message || 'Failed to update exam');
    }

    // Mapping ke entity Exam
    function mapExamRow(row: any): Exam {
      return {
        ...row,
        notes: row.notes ?? null,
        updated_at: row.updated_at ?? null,
        updated_by: row.updated_by ?? null,
        deleted_at: row.deleted_at ?? null,
        deleted_by: row.deleted_by ?? null,
      };
    }

    return mapExamRow(newData);
  }


  async softDelete(id: string, deletedBy: string, user?: any): Promise<Exam> {
    // Ambil dulu row lama
    await this.assertCanAccessExam(id, user);

    const updatedRow = {
      deleted_at: new Date(),
      deleted_by: deletedBy,
    };

    const { data: newData, error: updateError } = await this.supabase
      .from('exams')
      .update(updatedRow)
      .eq('id', id)
      .select()
      .single();

    if (updateError || !newData) {
      throw new InternalServerErrorException(updateError?.message || 'Failed to soft delete exam');
    }

    // Mapping ke entity Exam
    function mapExamRow(row: any): Exam {
      return {
        ...row,
        notes: row.notes ?? null,
        updated_at: row.updated_at ?? null,
        updated_by: row.updated_by ?? null,
        deleted_at: row.deleted_at ?? null,
        deleted_by: row.deleted_by ?? null,
      };
    }

    return mapExamRow(newData);
  }


  async getExamQuestions(examId: string, user?: any): Promise<{ examId: string; questions: Questionnaire[] }> {
    await this.assertCanAccessExam(examId, user);

    const { data: rawQuestions, error } = await this.supabase
      .from('questionnaires')
      .select('*')
      .eq('exam_id', examId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    const questions: Questionnaire[] = (rawQuestions || []).map(q => ({
      ...q,
      notes: q.notes ?? null,
      created_at: q.created_at,
      updated_at: q.updated_at ?? null,
      deleted_at: q.deleted_at ?? null,
    }));

    return { examId, questions };
  }

  async getTodayExamsWithPagination(
    studentId: string,
    search: string,
    sort: string,
    order: 'asc' | 'desc',
    page: number,
    limit: number,
    debug = false,
  ): Promise<{ data: Exam[]; meta: { total: number; page: number; limit: number; totalPages: number; debug?: any } }> {
    const offset = (page - 1) * limit;
    
    // Get "Today" string in YYYY-MM-DD format for Asia/Jakarta (GMT+7)
    const now = new Date();
    const todayStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);

    const {data: rows,error} = await this.supabase.from('exam_students')
      .select('exam:exams!inner(*,subject:subjects(id,name,class_id))').eq('student_id',studentId)
      .is('deleted_at',null).is('exam.deleted_at',null).eq('exam.date',todayStr);
    if (error) throw new InternalServerErrorException(error.message);
    const candidateExams: any[] = (rows || []).flatMap(row => row.exam || []);
    const searchTerm = search.trim().toLowerCase();
    const todayExams = (candidateExams || []).filter((exam) => {
      const isToday = this.getDatePart(exam.date) === todayStr;
      if (!isToday) return false;
      if (!searchTerm) return true;

      return [exam.title, exam.type]
        .some((value) => String(value ?? '').toLowerCase().includes(searchTerm));
    });

    const sortedExams = this.sortExamRows(todayExams, sort, order);
    const exams = sortedExams.slice(offset, offset + limit);
    const total = sortedExams.length;

    // 4. Cek mana saja yang sudah di-submit oleh student ini
    const examIdsFound = (exams || []).map(e => e.id);
    let submittedExamIds = new Set<string>();

    if (examIdsFound.length > 0) {
      const { data: submissions, error: submissionsError } = await this.supabase
        .from('exam_submissions')
        .select('exam_id, answers')
        .eq('student_id', studentId)
        .in('exam_id', examIdsFound);

      if (submissionsError) throw new InternalServerErrorException(submissionsError.message);
      submittedExamIds = new Set(
        (submissions || [])
          .filter((submission) => this.hasSubmittedAnswers(submission.answers))
          .map(s => s.exam_id),
      );
    }

    const finalData = (exams || []).map(e => ({
      ...e,
      is_submitted: submittedExamIds.has(e.id),
    }));

    return {
      data: finalData,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
