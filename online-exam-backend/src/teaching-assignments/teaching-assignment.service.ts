import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class TeachingAssignmentService {
  constructor(private readonly supabase: SupabaseClient) {}

  private relation(value: any) {
    return Array.isArray(value) ? value[0] : value;
  }

  async list(user?: any) {
    let query = this.supabase
      .from('teaching_assignments')
      .select(
        'id,subject_id,teacher_id,class_id,created_at,subject:subjects(id,name,description),teacher:users(id,name,userid,is_active),class:classes(id,name,grade)',
      )
      .is('deleted_at', null);

    if (String(user?.role || '').toUpperCase() === 'GURU') {
      query = query.eq('teacher_id', user.sub);
    }

    const { data, error } = await query.order('created_at', { ascending: true });
    if (error) throw new InternalServerErrorException(error.message);

    return {
      data: (data || []).map((row: any) => ({
        ...row,
        subject: this.relation(row.subject),
        teacher: this.relation(row.teacher),
        class: this.relation(row.class),
      })),
      meta: { total: data?.length || 0 },
    };
  }

  async create(body: any, createdBy: string) {
    const subjectId = String(body.subject_id || '').trim();
    const teacherId = String(body.teacher_id || '').trim();
    const classIds: string[] = Array.from(
      new Set((Array.isArray(body.class_ids) ? body.class_ids : [body.class_id]).filter(Boolean).map(String)),
    ) as string[];

    if (!subjectId || !teacherId || classIds.length === 0) {
      throw new BadRequestException('Mapel, guru, dan minimal satu kelas wajib dipilih.');
    }

    const [{ data: subject }, { data: teacher }, { data: classes, error: classError }] = await Promise.all([
      this.supabase.from('subjects').select('id').eq('id', subjectId).is('deleted_at', null).maybeSingle(),
      this.supabase.from('users').select('id').eq('id', teacherId).eq('role', 'GURU').eq('is_active', true).is('deleted_at', null).maybeSingle(),
      this.supabase.from('classes').select('id').in('id', classIds).is('deleted_at', null),
    ]);

    if (!subject) throw new NotFoundException('Mata pelajaran tidak ditemukan.');
    if (!teacher) throw new BadRequestException('Guru tidak ditemukan atau tidak aktif.');
    if (classError) throw new InternalServerErrorException(classError.message);
    if ((classes || []).length !== classIds.length) throw new BadRequestException('Ada kelas yang tidak valid.');

    const { data: existing, error: existingError } = await this.supabase
      .from('teaching_assignments')
      .select('class_id')
      .eq('subject_id', subjectId)
      .eq('teacher_id', teacherId)
      .is('deleted_at', null)
      .in('class_id', classIds);
    if (existingError) throw new InternalServerErrorException(existingError.message);
    const existingIds = new Set((existing || []).map((row) => String(row.class_id)));
    const payload = classIds.filter((classId) => !existingIds.has(classId)).map((classId) => ({
      subject_id: subjectId,
      teacher_id: teacherId,
      class_id: classId,
      created_by: createdBy,
    }));
    if (payload.length === 0) return { data: [], created: 0 };
    const { data, error } = await this.supabase.from('teaching_assignments').insert(payload).select();

    if (error) throw new InternalServerErrorException(error.message);
    return { data: data || [], created: data?.length || 0 };
  }

  async remove(id: string, deletedBy: string) {
    const { data, error } = await this.supabase
      .from('teaching_assignments')
      .update({ deleted_at: new Date(), deleted_by: deletedBy })
      .eq('id', id)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException('Penugasan mengajar tidak ditemukan.');
    return { success: true };
  }

  async allowedClassIds(teacherId: string, subjectId: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('teaching_assignments')
      .select('class_id')
      .eq('teacher_id', teacherId)
      .eq('subject_id', subjectId)
      .is('deleted_at', null);
    if (error) throw new InternalServerErrorException(error.message);
    return (data || []).map((row) => String(row.class_id));
  }
}
