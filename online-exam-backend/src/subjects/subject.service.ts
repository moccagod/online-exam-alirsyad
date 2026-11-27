import { Injectable, NotFoundException, InternalServerErrorException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { Subject } from './entities/subject.entity';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';

@Injectable()
export class SubjectService {
  constructor(private readonly supabase: SupabaseClient) {}

  async create(dto: CreateSubjectDto): Promise<Subject> {
    const name = String(dto.name || '').trim();
    const { data: existing, error: checkError } = await this.supabase
      .from('subjects')
      .select('id')
      .ilike('name', name)
      .is('deleted_at', null)
      .is('canonical_subject_id', null)
      .maybeSingle();

    if (checkError) throw new InternalServerErrorException(checkError.message);
    if (existing) {
      throw new BadRequestException(`Mata pelajaran ${name} sudah ada.`);
    }

    const { data, error } = await this.supabase
      .from('subjects')
      .insert([{ name, description: dto.description || null, created_by: dto.created_by, class_id: null, teacher_id: null }])
      .select()
      .single();

    if (error) throw new InternalServerErrorException(error.message);
    return data!;
  }

  async getDataWithPagination(
    search: string,
    sort: string,
    order: 'asc' | 'desc',
    page: number,
    limit: number,
    user?: any,
  ): Promise<{ data: Subject[]; meta: any }> {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    try {
      let query = this.supabase
        .from('subjects')
        .select('*, assignments:teaching_assignments!subject_id(id,class_id,teacher_id,deleted_at,teacher:users!teacher_id(id,name,is_active),class:classes!class_id(id,name,grade))', { count: 'exact' })
        .is('deleted_at', null)
        .is('canonical_subject_id', null);

      if (search?.trim()) {
        const keyword = search.trim().toLowerCase();
        query = query.or(`name.ilike.%${keyword}%,description.ilike.%${keyword}%`);
      }

      if (String(user?.role || '').toUpperCase() === 'GURU') {
        const { data: assignments, error: assignmentError } = await this.supabase
          .from('teaching_assignments')
          .select('subject_id')
          .eq('teacher_id', user.sub)
          .is('deleted_at', null);
        if (assignmentError) throw new InternalServerErrorException(assignmentError.message);
        const ids = Array.from(new Set((assignments || []).map((item) => item.subject_id)));
        if (ids.length === 0) return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
        query = query.in('id', ids);
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
    } catch (err: any) {
      throw new InternalServerErrorException(err.message);
    }
  }

  async getDataOnly(user?: any): Promise<{ data: Subject[]; meta: any }> {
    try {
      let query = this.supabase
        .from('subjects')
        .select('*, assignments:teaching_assignments!subject_id(id,class_id,teacher_id,deleted_at,teacher:users!teacher_id(id,name,is_active),class:classes!class_id(id,name,grade))')
        .is('deleted_at', null)
        .is('canonical_subject_id', null);

      if (String(user?.role || '').toUpperCase() === 'GURU') {
        const { data: assignments, error: assignmentError } = await this.supabase
          .from('teaching_assignments')
          .select('subject_id')
          .eq('teacher_id', user.sub)
          .is('deleted_at', null);
        if (assignmentError) throw new InternalServerErrorException(assignmentError.message);
        const ids = Array.from(new Set((assignments || []).map((item) => item.subject_id)));
        if (ids.length === 0) return { data: [], meta: { total: 0 } };
        query = query.in('id', ids);
      }

      const { data, error } = await query
        .order('name', { ascending: true });

      if (error) throw new InternalServerErrorException(error.message);

      return {
        data: data || [],
        meta: { total: data?.length || 0 },
      };
    } catch (err: any) {
      throw new InternalServerErrorException(err.message);
    }
  }

  async findById(id: string, user?: any): Promise<Subject> {
    try {
      const { data, error } = await this.supabase
        .from('subjects')
        .select('*, assignments:teaching_assignments!subject_id(id,class_id,teacher_id,deleted_at,teacher:users!teacher_id(id,name,is_active),class:classes!class_id(id,name,grade))')
        .is('deleted_at', null)
        .is('canonical_subject_id', null)
        .eq('id', id)
        .single();

      if (error || !data) throw new NotFoundException(`Subject ${id} not found`);

      if (String(user?.role || '').toUpperCase() === 'GURU') {
        const allowed = (data.assignments || []).some(
          (assignment: any) => !assignment.deleted_at && assignment.teacher_id === user.sub,
        );
        if (!allowed) throw new ForbiddenException('Anda tidak memiliki akses ke mata pelajaran ini.');
      }

      return data;
    } catch (err: any) {
      if (err instanceof ForbiddenException) throw err;
      throw new NotFoundException(err.message);
    }
  }

  async update(id: string, dto: UpdateSubjectDto & { updated_by?: string }): Promise<Subject> {
    // Get existing to merge and check
    const { data: current, error: fetchError } = await this.supabase
      .from('subjects')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !current) throw new NotFoundException(`Subject ${id} not found`);

    const newName = String(dto.name || current.name).trim();

    // CHECK DUPLICATE if name or class_id changed
    if (dto.name) {
      const { data: existing, error: checkError } = await this.supabase
        .from('subjects')
        .select('id')
        .ilike('name', newName)
        .is('deleted_at', null)
        .is('canonical_subject_id', null)
        .neq('id', id)
        .maybeSingle();

      if (checkError) throw new InternalServerErrorException(checkError.message);
      if (existing) {
        throw new BadRequestException(`Mata pelajaran ${newName} sudah ada.`);
      }
    }

    const updatePayload = {
      ...(dto.name !== undefined ? { name: newName } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.updated_by !== undefined ? { updated_by: dto.updated_by } : {}),
      updated_at: new Date(),
    };

    const { data, error } = await this.supabase
      .from('subjects')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) throw new NotFoundException(`Subject ${id} not found`);
    return data;
  }

  async softDelete(id: string, deletedBy: string): Promise<Subject> {
    try {
      const [{ data: assignment }, { data: exam }] = await Promise.all([
        this.supabase.from('teaching_assignments').select('id').eq('subject_id', id).is('deleted_at', null).limit(1).maybeSingle(),
        this.supabase.from('exams').select('id').eq('subject_id', id).is('deleted_at', null).limit(1).maybeSingle(),
      ]);
      if (assignment || exam) {
        throw new BadRequestException('Mapel masih dipakai oleh penugasan atau ujian aktif.');
      }
      const { data, error } = await this.supabase
        .from('subjects')
        .update({ deleted_at: new Date(), deleted_by: deletedBy })
        .eq('id', id)
        .select()
        .single();

      if (error || !data) throw new NotFoundException(`Subject ${id} not found`);
      return data;
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      throw new InternalServerErrorException(err.message);
    }
  }
}
