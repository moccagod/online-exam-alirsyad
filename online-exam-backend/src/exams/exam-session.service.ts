import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class ExamSessionService {
  constructor(private readonly supabase: SupabaseClient) {}

  async prepare(exam: string, student: string, token: string, start: boolean) {
    const { data, error } = await this.supabase.rpc('exam_prepare', {
      p_exam: exam, p_student: student, p_token: token || '', p_start: start,
    });
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async attempt(id: string, student: string, action: string, body: any) {
    if (action === 'draft' && (!Number.isSafeInteger(body?.revision) || body.revision < 0)) {
      throw new BadRequestException('Revisi draf tidak valid');
    }
    if (action === 'violation' && (typeof body?.event !== 'string' || !/^[\w-]{1,80}$/.test(body.event))) {
      throw new BadRequestException('Kode kejadian tidak valid');
    }
    const { data, error } = await this.supabase.rpc('exam_attempt', {
      p_session: id, p_student: student, p_action: action, p_body: body,
    });
    if (error) throw new BadRequestException(error.message);
    return data;
  }
}
