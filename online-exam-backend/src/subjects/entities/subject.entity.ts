export class Subject {
  id: string;
  name: string;
  description?: string;

  created_at: Date;
  created_by: string;

  updated_at?: Date;
  updated_by?: string;

  deleted_at?: Date;
  deleted_by?: string;

  class_id?: string | null;
  teacher_id?: string;
  canonical_subject_id?: string | null;
  assignments?: any[];

  // Relasi manual (opsional)
  classes?: any;
  teacher?: any;
  exams?: any[];
}
