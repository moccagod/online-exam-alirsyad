import { Injectable, InternalServerErrorException, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

export interface CreateExamSubmissionDto {
  exam_id: string;
  student_id: string;
  session_id: string;
  answers: any[];
  created_by: string;
}

@Injectable()
export class ExamSubmissionService {
  constructor(private readonly supabase: SupabaseClient) {}

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

  async getSubmittedExamsByStudent(
    studentId: string,
    search: string,
    sort: string = 'created_at',
    order: 'asc' | 'desc' = 'desc',
    page: number = 1,
    limit: number = 10,
  ) {
    const offset = (page - 1) * limit;

    const query = this.supabase
      .from('exam_submissions')
      .select(
        `
        *,
        exam:exams(*, subject:subjects(*))
      `,
      )
      .eq('student_id', studentId);

    const keyword = search?.trim().toLowerCase();

    const { data, error } = await query.order(sort, { ascending: order === 'asc' });

    if (error) throw new InternalServerErrorException(error.message);

    const answeredSubmissions = (data || []).filter((submission: any) =>
      this.hasSubmittedAnswers(submission.answers),
    );

    const filteredData = keyword
      ? answeredSubmissions.filter((submission: any) =>
          [submission.exam?.title, submission.exam?.type].some((value) =>
            String(value ?? '').toLowerCase().includes(keyword),
          ),
        )
      : answeredSubmissions;

    const paginatedData = filteredData.slice(offset, offset + limit);

    return {
      data: paginatedData,
      meta: {
        total: filteredData.length,
        page,
        limit,
        totalPages: Math.ceil(filteredData.length / limit),
      },
    };
  }

  async getSubmissionDetail(submissionId: string, studentId?: string) {
    let query = this.supabase
      .from('exam_submissions')
      .select(
        `
        *,
        exam:exams(*, subject:subjects(*))
      `,
      )
      .eq('id', submissionId);

    if (studentId) query = query.eq('student_id', studentId);

    const { data, error } = await query.single();

    if (error || !data) throw new NotFoundException('Submission tidak ditemukan');

    const answerList = Array.isArray(data.answers) ? data.answers : [];
    const answerByQuestionId = new Map<string, any>(
      answerList.map((answer) => [String(answer.question_id), answer]),
    );

    const { data: questions, error: qError } = await this.supabase
      .from('exam_version_questions')
      .select('*')
      .eq('exam_id', data.exam_id)
      .is('deleted_at', null)
      .order('index', { ascending: true });

    if (qError) throw new InternalServerErrorException(qError.message);

    data.answers = (questions || []).map((question) => {
      const answer = answerByQuestionId.get(String(question.id));
      return {
        ...(answer || {}),
        question_id: question.id,
        answer: answer?.answer ?? '',
        is_correct: answer?.is_correct ?? (question.type === 'multiple_choice' ? false : null),
        question: studentId ? {...question, answer: undefined} : question,
      };
    });

    return data;
  }

  async hasSubmitted(examId: string, studentId: string) {
    const { data, error } = await this.supabase
      .from('exam_submissions')
      .select('id,session_id,answers')
      .eq('exam_id', examId)
      .eq('student_id', studentId);

    if (error) throw new InternalServerErrorException(error.message);

    const result = data?.find(row => this.hasSubmittedAnswers(row.answers));
    return {submitted: Boolean(result), receipt:result?.id, session:result?.session_id};
  }

  async submit(dto: CreateExamSubmissionDto, revision: number) {
    if (!Number.isSafeInteger(revision) || revision<0) throw new BadRequestException('Revisi draf tidak valid');
    const {data: session} = await this.supabase.from('exam_sessions').select('id')
      .eq('id',dto.session_id).eq('exam_id',dto.exam_id).eq('student_id',dto.student_id).maybeSingle();
    if (!session) throw new ForbiddenException('Sesi tidak tersedia');
    if (dto.answers.some(item => !item || typeof item.question_id !== 'string' || typeof item.answer !== 'string')) {
      throw new BadRequestException('Format jawaban tidak valid');
    }
    const draft = Object.fromEntries(dto.answers.map(item => [item.question_id, item.answer]));
    const {data,error} = await this.supabase.rpc('exam_attempt', {
      p_session: session.id, p_student: dto.student_id, p_action: 'submit', p_body: {draft,revision}
    });
    if (error) throw new BadRequestException(error.message);
    return data;
  }
}
