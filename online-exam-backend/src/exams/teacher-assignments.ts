import { SupabaseClient } from '@supabase/supabase-js';
import { InternalServerErrorException } from '@nestjs/common';

export async function assignedExams(db: SupabaseClient, teacher: string) {
  const { data, error } = await db
    .from('exam_teacher_assignments')
    .select('id,subject_id')
    .eq('teacher_id', teacher);
  if (error) throw new InternalServerErrorException(error.message);
  return data || [];
}
