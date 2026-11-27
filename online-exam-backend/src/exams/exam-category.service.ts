import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class ExamCategoryService {
  constructor(private readonly supabase: SupabaseClient) {}

  async list() {
    const { data, error } = await this.supabase.from('exam_categories')
      .select('id,name,created_at,updated_at').order('name');
    if (error) throw new InternalServerErrorException(error.message);
    return data;
  }

  async assertExists(id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new BadRequestException('Kategori ujian tidak tersedia.');
    }
    const { data, error } = await this.supabase.from('exam_categories')
      .select('id').eq('id', id).maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new BadRequestException('Kategori ujian tidak tersedia.');
  }

  private normalizeName(name: unknown) {
    if (typeof name !== 'string') throw new BadRequestException('Nama kategori wajib diisi.');
    const normalized = name.trim().replace(/\s+/g, ' ');
    if (!normalized || normalized.length > 120) {
      throw new BadRequestException('Nama kategori harus berisi 1 sampai 120 karakter.');
    }
    return normalized;
  }

  private throwWriteError(error: any): never {
    if (error?.code === '23505') throw new ConflictException('Nama kategori sudah digunakan.');
    throw new InternalServerErrorException(error?.message || 'Gagal menyimpan kategori.');
  }

  async create(name: unknown, userId: string) {
    const { data, error } = await this.supabase.from('exam_categories')
      .insert({ name: this.normalizeName(name), created_by: userId }).select('id,name,created_at,updated_at').single();
    if (error) this.throwWriteError(error);
    return data;
  }

  async rename(id: string, name: unknown, userId: string) {
    const { data, error } = await this.supabase.from('exam_categories')
      .update({ name: this.normalizeName(name), updated_at: new Date().toISOString(), updated_by: userId })
      .eq('id', id).select('id,name,created_at,updated_at').maybeSingle();
    if (error) this.throwWriteError(error);
    if (!data) throw new NotFoundException('Kategori ujian tidak ditemukan.');
    return data;
  }
}
