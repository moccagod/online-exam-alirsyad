import { createHash } from 'crypto';
import * as XLSX from 'xlsx';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { Questionnaire } from './entities/questionnaire.entity';
import { CreateQuestionnaireDto } from './dto/create-questionnaire.dto';
import { UpdateQuestionnaireDto } from './dto/update-questionnaire.dto';

@Injectable()
export class QuestionnaireService {
  constructor(private readonly supabase: SupabaseClient) {}

  private normalizeIndex(value: unknown): number {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
  }

  private async assertCanManageExam(examId: string, user?: any) {
    const role = String(user?.role || '').toUpperCase();
    if (role === 'ADMIN') return;

    if (role === 'GURU') {
      const { data: exam, error } = await this.supabase
        .from('exams')
        .select('id, assigned_teacher_id, subject:subjects(teacher_id)')
        .eq('id', examId)
        .is('deleted_at', null)
        .single();

      if (error || !exam) throw new NotFoundException('Exam not found');

      const subject = Array.isArray(exam.subject) ? exam.subject[0] : exam.subject;
      if ((exam.assigned_teacher_id ?? subject?.teacher_id) === user?.sub) return;
    }

    throw new ForbiddenException('Anda tidak memiliki akses ke soal ujian ini');
  }

  private async source(id: string, user: any) {
    await this.assertCanManageExam(id,user);
    const {data,error} = await this.supabase.from('exams').select('package_exam_id').eq('id',id).single();
    if (error) throw new NotFoundException('Ujian tidak ditemukan');
    if (data.package_exam_id) await this.assertCanManageExam(data.package_exam_id,user);
    return data.package_exam_id || id;
  }

  async packages(id: string, user: any) {
    await this.assertCanManageExam(id,user);
    const {data,error} = await this.supabase.from('exams').select('id,title,package_exam_id,assigned_teacher_id,subject:subjects(name,teacher_id)').is('deleted_at',null);
    if (error) throw new InternalServerErrorException(error.message);
    const rows = (data || []).map(row=>({...row,subject:Array.isArray(row.subject)?row.subject[0]:row.subject}));
    const current = rows.find(row=>row.id===id);
    if (!current) throw new NotFoundException('Ujian tidak ditemukan');
    const choices = rows.filter(row=> !row.package_exam_id && (row.assigned_teacher_id ?? row.subject?.teacher_id)===(current?.assigned_teacher_id ?? current?.subject?.teacher_id) &&
      row.subject?.name?.trim().toLowerCase()===current?.subject?.name?.trim().toLowerCase());
    return {selected:current?.package_exam_id || id,choices:choices.map(({id,title})=>({id,title}))};
  }

  async link(id: string, source: string, user: any) {
    const {choices} = await this.packages(id,user);
    if (source!==id && !choices.some(row=>row.id===source)) throw new BadRequestException('Paket tidak tersedia');
    if (source !== id) {
      const {data: linked, error} = await this.supabase.from('exams').select('id')
        .eq('package_exam_id', id).is('deleted_at', null).limit(1);
      if (error) throw new InternalServerErrorException(error.message);
      if (linked?.length) throw new BadRequestException('Paket sesi ini dipakai oleh ujian lain');
    }
    const {error} = await this.supabase.from('exams').update({package_exam_id:source===id?null:source}).eq('id',id);
    if (error) throw new InternalServerErrorException(error.message);
    return {selected:source};
  }

  async importWorkbook(id: string, user: any, file: Buffer, save: boolean) {
    const source = await this.source(id,user);
    let grid: unknown[][];
    try {
      const book = XLSX.read(file,{type:'buffer',sheetRows:502});
      grid = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1,blankrows:true,raw:false,range:0});
    } catch { throw new BadRequestException('Berkas Excel tidak dapat dibaca'); }
    if (grid.length > 501) throw new BadRequestException('Maksimal 500 baris soal per impor');
    const header = ['Tipe','Pertanyaan','A','B','C','D','E','Kunci'];
    if (!header.every((v,i)=>grid[0]?.[i]===v)) throw new BadRequestException('Gunakan kolom dari template');
    const errors: string[] = [];
    const rows: any[] = [];
    const escape = (v:string)=>v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    grid.slice(1).forEach((cells,i)=>{
      const [kind,question,...tail] = header.map((_,j)=>String(cells[j]??'').trim());
      if (!kind && !question && !tail.some(Boolean)) return;
      const key = tail.pop() || '';
      const values = tail.filter(Boolean);
      const correct = tail['ABCDE'.indexOf(key.toUpperCase())];
      if (!question || !['PG','Esai'].includes(kind) || (kind==='PG' && (values.length<2 || !/^[A-E]$/i.test(key) || !correct || new Set(values).size!==values.length))) {
        errors.push('Baris ' + (i+2) + ': periksa tipe, pertanyaan, pilihan dan kunci.');
      }
      const fingerprint = createHash('sha256').update(JSON.stringify([source,i,kind,question,tail,key])).digest('hex').slice(0,32);
      rows.push({id:fingerprint,exam_id:source,index:i+1,type:kind==='PG'?'multiple_choice':'essay',
        question:escape(question), options:kind==='PG'?values.map(v=>({type:'text',value:escape(v)})):[],
        answer:escape(kind==='PG'?correct || '':key),created_by:user.sub});
    });
    if (!rows.length) errors.push('Berkas kosong');
    if (save && !errors.length) {
      const {error} = await this.supabase.from('questionnaires').upsert(rows,{onConflict:'id',ignoreDuplicates:true});
      if (error) throw new InternalServerErrorException(error.message);
    }
    return {errors,rows:rows.map(row=>({index:row.index+1,question:row.question,type:row.type,answer:row.answer,options:row.options.map(option=>option.value)}))};
  }

  private async assertCanManageQuestionnaire(questionnaireId: string, user?: any) {
    const questionnaire = await this.findById(questionnaireId);
    await this.assertCanManageExam(questionnaire.exam_id, user);
    return questionnaire;
  }

  async create(dto: CreateQuestionnaireDto & { created_by: string }, user?: any): Promise<Questionnaire> {
    if (!dto.exam_id) throw new NotFoundException('Exam not found');
    dto.exam_id = await this.source(dto.exam_id, user);

    const { data, error } = await this.supabase
      .from('questionnaires')
      .insert({
        ...dto,
        index: this.normalizeIndex(dto.index),
        created_at: new Date(),
      })
      .select()
      .single();

    if (error) throw new InternalServerErrorException(error.message);
    return data!;
  }

  async getDataWithPagination(
    examId: string,
    search: string,
    sort: string,
    order: 'asc' | 'desc',
    page: number,
    limit: number,
    user?: any,
  ): Promise<{ data: Questionnaire[]; meta: any }> {
    examId = await this.source(examId, user);

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = this.supabase
      .from('questionnaires')
      .select('*', { count: 'exact' })
      .eq('exam_id', examId)
      .is('deleted_at', null);

    if (search) {
      query = query.or(`question.ilike.%${search}%,type.ilike.%${search}%,answer.ilike.%${search}%`);
    }

    query = query.order(sort, { ascending: order === 'asc' }).range(from, to);

    const { data, count, error } = await query;
    if (error) throw new InternalServerErrorException(error.message);

    return {
      data: data || [],
      meta: {
        total: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit),
      },
    };
  }

  async findById(id: string, user?: any): Promise<Questionnaire> {
    const { data, error } = await this.supabase
      .from('questionnaires')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error || !data) throw new NotFoundException(`Questionnaire ${id} not found`);
    if (user) await this.assertCanManageExam(data.exam_id, user);
    return data;
  }

  async update(
    id: string,
    dto: UpdateQuestionnaireDto & { updated_by?: string },
    user?: any,
  ): Promise<Questionnaire> {
    await this.assertCanManageQuestionnaire(id, user);

    const { data, error } = await this.supabase
      .from('questionnaires')
      .update({
        ...dto,
        ...(dto.index !== undefined ? { index: this.normalizeIndex(dto.index) } : {}),
        updated_at: new Date(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new InternalServerErrorException(error.message);
    return data!;
  }

  async softDelete(id: string, deletedBy: string, user?: any): Promise<Questionnaire> {
    await this.assertCanManageQuestionnaire(id, user);

    const { data, error } = await this.supabase
      .from('questionnaires')
      .update({
        deleted_at: new Date(),
        deleted_by: deletedBy,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new InternalServerErrorException(error.message);
    return data!;
  }
}
