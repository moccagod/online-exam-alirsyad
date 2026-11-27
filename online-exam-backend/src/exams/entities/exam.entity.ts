export class Exam {
  id: string;
  title: string;
  date: string; // tetap string, sesuai DB

  type: string;
  duration: number;
  multiple_choice_weight?: number;
  essay_weight?: number;
  notes?: string | null; // bisa null dari DB

  created_at: string; // atau Date kalau mau konversi manual
  created_by: string;

  updated_at?: string | null;
  updated_by?: string | null;

  deleted_at?: string | null;
  deleted_by?: string | null;

  subject_id: string;
  assigned_teacher_id?: string | null;
  package_exam_id?: string | null;
  category_id?: string | null;
  category?: { id: string; name: string } | null;
  starts_at?: string | null;
  ends_at?: string | null;
  token?: string | null;

  // Relasi manual (opsional)
  subject?: any;
  target_classes?: any[];
  questionnaires?: any[];
}
