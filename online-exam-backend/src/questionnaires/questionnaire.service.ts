import { createHash } from 'crypto';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
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
    const images = new Map<string, { buffer: Buffer; extension: 'png' | 'jpeg' }>();
    const errors: string[] = [];
    try {
      const book = XLSX.read(file,{type:'buffer',sheetRows:502});
      grid = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1,blankrows:true,raw:false,range:0});
    } catch { throw new BadRequestException('Berkas Excel tidak dapat dibaca'); }
    if (grid.length > 501) throw new BadRequestException('Maksimal 500 baris soal per impor');
    const header = ['Tipe','Pertanyaan','A','B','C','D','E','Kunci'];
    if (!header.every((v,i)=>grid[0]?.[i]===v)) throw new BadRequestException('Gunakan kolom dari template');
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file as any);
      const sheet = workbook.worksheets[0];
      for (const image of sheet.getImages()) {
        const row = Math.floor(image.range.tl.nativeRow) + 1;
        const col = Math.floor(image.range.tl.nativeCol) + 1;
        const cell = `${row}:${col}`;
        const media = workbook.getImage(Number(image.imageId));
        const buffer = media?.buffer ? Buffer.from(media.buffer as any) : null;
        const extension = media?.extension;
        if (row < 2 || row > 501 || col < 2 || col > 7 || images.has(cell) || !buffer ||
            (extension !== 'png' && extension !== 'jpeg') || buffer.length > 2 * 1024 * 1024 ||
            Math.floor(image.range.br.nativeRow) + 1 !== row || Math.floor(image.range.br.nativeCol) + 1 !== col) {
          errors.push(`Gambar pada baris ${row}, kolom ${col}: gunakan satu PNG/JPEG maksimal 2 MB yang berada dalam satu sel Pertanyaan atau A–E.`);
          continue;
        }
        images.set(cell, {buffer,extension});
      }
    } catch { throw new BadRequestException('Gambar dalam berkas Excel tidak dapat dibaca'); }
    const rows: any[] = [];
    const uploads = new Map<string, {buffer: Buffer; contentType: string}>();
    const escape = (v:string)=>v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const withImage = (value: string, row: number, col: number, questionId: string) => {
      const image = images.get(`${row}:${col}`);
      const text = escape(value);
      if (!image) return text;
      const hash = createHash('sha256').update(image.buffer).digest('hex').slice(0,24);
      const name = `${col}-${hash}.${image.extension}`;
      const uri = `exam-image://${questionId}/${name}`;
      uploads.set(`${questionId}/${name}`, {buffer:image.buffer,contentType:`image/${image.extension}`});
      return `${text}${text ? '<br>' : ''}<img src="${save ? uri : `data:image/${image.extension};base64,${image.buffer.toString('base64')}`}" alt="Gambar soal">`;
    };
    grid.slice(1).forEach((cells,i)=>{
      const [kind,question,...tail] = header.map((_,j)=>String(cells[j]??'').trim());
      if (!kind && !question && !tail.some(Boolean)) return;
      const key = tail.pop() || '';
      const rowNumber = i + 2;
      const filled = tail.map((v,j)=>Boolean(v || images.has(`${rowNumber}:${j+3}`)));
      const values = tail.map((value,j)=>filled[j] ? `${value}:${images.get(`${rowNumber}:${j+3}`)?.buffer.toString('base64') || ''}` : null).filter(Boolean);
      const correctIndex = 'ABCDE'.indexOf(key.toUpperCase());
      if ((!question && !images.has(`${rowNumber}:2`)) || !['PG','Esai'].includes(kind) || (kind==='PG' && (values.length<2 || correctIndex<0 || !filled[correctIndex] || new Set(values).size!==values.length))) {
        errors.push('Baris ' + (i+2) + ': periksa tipe, pertanyaan, pilihan dan kunci.');
      }
      const imageHashes = [2,3,4,5,6,7].map(col=>{
        const image = images.get(`${rowNumber}:${col}`);
        return image ? createHash('sha256').update(image.buffer).digest('hex') : null;
      });
      const fingerprintParts: unknown[] = [source,i,kind,question,tail,key];
      if (imageHashes.some(Boolean)) fingerprintParts.push(imageHashes);
      const fingerprint = createHash('sha256').update(JSON.stringify(fingerprintParts)).digest('hex').slice(0,32);
      const options = kind==='PG' ? tail.flatMap((value,j)=>filled[j] ? [{type:'text',value:withImage(value,rowNumber,j+3,fingerprint)}] : []) : [];
      rows.push({id:fingerprint,exam_id:source,index:i+1,type:kind==='PG'?'multiple_choice':'essay',
        question:withImage(question,rowNumber,2,fingerprint), options,
        answer:kind==='PG' ? options[filled.slice(0,correctIndex).filter(Boolean).length]?.value || '' : escape(key),created_by:user.sub});
    });
    if (!rows.length) errors.push('Berkas kosong');
    if (save && !errors.length) {
      if (uploads.size) {
        const bucket = await this.supabase.storage.getBucket('exam-question-images');
        if (bucket.error || !bucket.data) {
          const created = await this.supabase.storage.createBucket('exam-question-images', {
            public:false,
            allowedMimeTypes:['image/png','image/jpeg'],
            fileSizeLimit:2*1024*1024,
          });
          if (created.error && !/already exists|duplicate/i.test(created.error.message)) {
            throw new InternalServerErrorException(`Bucket gambar soal tidak tersedia: ${created.error.message}`);
          }
        } else if (bucket.data.public) {
          throw new InternalServerErrorException('Bucket gambar soal harus privat');
        }
      }
      const uploaded: string[] = [];
      try {
        for (const [path, image] of uploads) {
          const result = await this.supabase.storage.from('exam-question-images').upload(path,image.buffer,{contentType:image.contentType,upsert:false});
          if (result.error && !/already exists|duplicate/i.test(result.error.message)) throw result.error;
          if (!result.error) uploaded.push(path);
        }
        const {error} = await this.supabase.from('questionnaires').upsert(rows,{onConflict:'id',ignoreDuplicates:true});
        if (error) throw error;
      } catch (error: any) {
        if (uploaded.length) await this.supabase.storage.from('exam-question-images').remove(uploaded);
        throw new InternalServerErrorException(error.message);
      }
    }
    return {errors,rows:rows.map(row=>({index:row.index+1,question:row.question,type:row.type,answer:row.answer,options:row.options.map(option=>option.value)}))};
  }

  async readImportedImage(questionId: string, name: string, user: any) {
    if (!/^[2-7]-[a-f0-9]{24}\.(png|jpeg)$/.test(name)) throw new NotFoundException('Gambar tidak ditemukan');
    const {data: question, error} = await this.supabase.from('questionnaires')
      .select('exam_id,question,options').eq('id',questionId).is('deleted_at',null).single();
    if (error || !question) throw new NotFoundException('Gambar tidak ditemukan');
    const marker = `exam-image://${questionId}/${name}`;
    const content = [question.question, ...(Array.isArray(question.options) ? question.options.map((option:any)=>option.value) : [])];
    if (!content.some(value=>typeof value==='string' && value.includes(marker))) throw new NotFoundException('Gambar tidak ditemukan');
    if (String(user?.role).toUpperCase()==='SISWA') {
      const {data: exams, error: examError} = await this.supabase.from('exams').select('id')
        .or(`id.eq.${question.exam_id},package_exam_id.eq.${question.exam_id}`).is('deleted_at',null);
      if (examError) throw new InternalServerErrorException(examError.message);
      const ids = (exams || []).map(exam=>exam.id);
      if (!ids.length) throw new ForbiddenException('Anda tidak memiliki akses ke gambar soal ini');
      const {data: assigned, error: assignedError} = await this.supabase.from('exam_students').select('id')
        .eq('student_id',user.sub).in('exam_id',ids).is('deleted_at',null).limit(1).maybeSingle();
      if (assignedError) throw new InternalServerErrorException(assignedError.message);
      if (!assigned) throw new ForbiddenException('Anda tidak memiliki akses ke gambar soal ini');
    } else {
      await this.assertCanManageExam(question.exam_id,user);
    }
    const {data, error: downloadError} = await this.supabase.storage.from('exam-question-images').download(`${questionId}/${name}`);
    if (downloadError || !data) throw new NotFoundException('Gambar tidak ditemukan');
    return {buffer:Buffer.from(await data.arrayBuffer()),contentType:name.endsWith('.png')?'image/png':'image/jpeg'};
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
