import { Injectable, NotFoundException, Logger, InternalServerErrorException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID } from 'crypto';
import { User } from './entities/user.entity';
import * as XLSX from 'xlsx';

const publicFields = 'id,name,userid,role,is_active,class_id,class_name,nisn,gender,description,created_at,created_by,updated_at,updated_by,deleted_at,deleted_by';
const classUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  constructor(private readonly supabase: SupabaseClient) {}

  private normalizeClassIdentifier(value: unknown): string {
    return String(value ?? '')
      .trim()
      .toUpperCase()
      .replace(/[\s_-]+/g, '');
  }

  private normalizeUserClass(user: Partial<User>) {
    const classId = String(user.class_id ?? '').trim();
    const classUuid = classId && classUuidPattern.test(classId) ? classId : null;
    const className = classUuid
      ? String(user.class_name ?? '').trim()
      : classId || String(user.class_name ?? '').trim();

    if (className.length > 20) {
      throw new BadRequestException('Kode kelas maksimal 20 karakter.');
    }

    return { class_id: classUuid, class_name: className };
  }

  private sortUsers(rows: any[], sort: string, order: 'asc' | 'desc') {
    const direction = order === 'asc' ? 1 : -1;

    return [...rows].sort((left, right) => {
      const leftValue = left?.[sort];
      const rightValue = right?.[sort];

      if (leftValue == null && rightValue == null) return 0;
      if (leftValue == null) return -1 * direction;
      if (rightValue == null) return 1 * direction;

      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        return (leftValue - rightValue) * direction;
      }

      return String(leftValue).localeCompare(String(rightValue), 'id', {
        numeric: true,
        sensitivity: 'base',
      }) * direction;
    });
  }

  // BULK UPLOAD USERS
  async bulkUploadUsers(fileBuffer: Buffer, createdBy: string) {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data: any[] = XLSX.utils.sheet_to_json(sheet);

    if (data.length === 0) {
      throw new BadRequestException('File Excel kosong atau format tidak valid.');
    }

    const defaultPassword = process.env.DEFAULT_NEW_USER_PASSWORD || '123456';
    const usersToInsert: any[] = [];
    const errors: string[] = [];
    const classIds = [
      ...new Set(
        data
          .map((row) => (row.class_id ? String(row.class_id).trim().toUpperCase() : ''))
          .filter(Boolean),
      ),
    ];
    const classNameById = new Map<string, string>();

    if (classIds.length > 0) {
      const { data: classes, error: classError } = await this.supabase
        .from('classes')
        .select('id, name')
        .in('id', classIds)
        .is('deleted_at', null);

      if (classError) throw new InternalServerErrorException(classError.message);
      (classes || []).forEach((classRow) => {
        classNameById.set(String(classRow.id).toUpperCase(), classRow.name);
      });
    }

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const {
        userid,
        name,
        nisn,
        gender,
        role,
        class_id,
        password,
        description,
      } = row;

      if (!userid || !name || !role) {
        errors.push(`Baris ${i + 2}: NIS/NIK, Nama, dan Role wajib diisi.`);
        continue;
      }

      // Check duplicate in current batch
      if (usersToInsert.some((u) => u.userid === String(userid))) {
        errors.push(`Baris ${i + 2}: Duplikat NIS/NIK ${userid} dalam file.`);
        continue;
      }

      const passwordSource = password || defaultPassword;
      const hashedPassword = bcrypt.hashSync(String(passwordSource), 10);

      const normalizedClassId = class_id ? String(class_id).trim().toUpperCase() : null;

      usersToInsert.push({
        id: randomUUID(),
        userid: String(userid),
        name: String(name),
        nisn: nisn ? String(nisn) : '',
        gender: gender ? String(gender).toUpperCase() : 'L',
        role: String(role).toUpperCase(),
        class_id: normalizedClassId,
        class_name: normalizedClassId ? (classNameById.get(normalizedClassId) || normalizedClassId) : '',
        password: hashedPassword,
        description: description ? String(description) : '',
        created_by: createdBy,
        is_active: true,
      });
    }

    if (errors.length > 0 && usersToInsert.length === 0) {
      throw new BadRequestException(errors.join('\n'));
    }

    // Insert to Supabase in batches of 50
    const batchSize = 50;
    for (let i = 0; i < usersToInsert.length; i += batchSize) {
      const batch = usersToInsert.slice(i, i + batchSize);
      const { error } = await this.supabase.from('users').insert(batch);
      if (error) {
        this.logger.error(`Error inserting batch ${i}: ${error.message}`);
        throw new InternalServerErrorException(`Gagal mengimpor batch ${i}: ${error.message}`);
      }
    }

    return {
      success: true,
      count: usersToInsert.length,
      errors: errors,
      message: `Berhasil mengimpor ${usersToInsert.length} user.${errors.length > 0 ? ` Terjadi ${errors.length} kesalahan.` : ''}`,
    };
  }

  // CREATE USER
  async createUser(user: Partial<User>): Promise<Omit<User, "password">> {
    Object.keys(user).forEach((key) => {
      if (user[key] === '') user[key] = null;
    });

    if (!user.id) {
      user.id = randomUUID();
    }

    if (user.created_by && !this.uuidRegex.test(String(user.created_by))) {
      user.created_by = user.id;
    }

    if (!user.created_by) {
      user.created_by = user.id;
    }

    const normalizedClass = this.normalizeUserClass(user);
    const duplicateUseridMessage = `User dengan NIK/NIS ${user.userid} sudah terdaftar!`;

    // CHECK DUPLICATE NIK/NIS (USERID)
    if (user.userid) {
      const existingUser = await this.getUserByNisNik(user.userid);
      if (existingUser) {
        throw new BadRequestException(duplicateUseridMessage);
      }
    }

    const { data, error } = await this.supabase
      .from('users')
      .insert({
        ...user,
        ...normalizedClass,
        nisn: user.nisn ?? '',
        description: user.description ?? '',
      })
      .select(publicFields)
      .single();

    if (
      error?.code === '23505' &&
      (error.message.includes('"UQ_users_userid"') || error.details?.startsWith('Key (userid)='))
    ) {
      throw new BadRequestException(duplicateUseridMessage);
    }
    if (error?.code === '22001') {
      throw new BadRequestException('Ada isian yang terlalu panjang. Periksa NIS/NIK, Nama, NISN, dan Deskripsi.');
    }
    if (error) throw new InternalServerErrorException(error.message);
    return data;
  }

  // PAGINATION
  async getUsersWithPagination(
    search: string,
    sort: string,
    order: 'asc' | 'desc',
    page: number,
    limit: number,
  ) {
    const offset = (page - 1) * limit;

    let query = this.supabase
      .from('users')
      .select(publicFields, { count: 'exact' })
      .is('deleted_at', null);

    if (search.trim()) {
      query = query.or(`name.ilike.%${search}%,userid.ilike.%${search}%,role.ilike.%${search}%,class_name.ilike.%${search}%`);
    }

    const { data, error, count } = await query
      .order(sort, { ascending: order === 'asc' })
      .range(offset, offset + limit - 1);

    if (error) throw new InternalServerErrorException(error.message);

    return {
      data,
      meta: {
        total: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit),
      },
    };
  }

  // ALL USERS
  async getAllUsers() {
    const { data, error } = await this.supabase
      .from('users')
      .select(publicFields)
      .is('deleted_at', null)
      .order('is_active', { ascending: false })
      .order('name', { ascending: true });

    if (error) throw new InternalServerErrorException(error.message);
    return data;
  }

  // USER BY NIS/NIK
  async getUserByNisNik(userid: string | number) {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('userid', String(userid))
      .is('deleted_at', null)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      this.logger.error(`Failed to fetch user by userid ${userid}: ${error.message}`);
      throw new InternalServerErrorException(`Gagal membaca data pengguna: ${error.message}`);
    }
    return data;
  }

  // USER BY ID
  async getUserById(id: string | number) {
    const { data } = await this.supabase
      .from('users')
      .select(publicFields)
      .eq('id', String(id))
      .is('deleted_at', null)
      .single();

    return data || null;
  }

  // UPDATE USER ACTIVE
  async updateUserStatus(
    id: string,
    isActive: boolean,
    updatedAt: Date,
    updatedBy: string,
  ) {
    const { data, error } = await this.supabase
      .from('users')
      .update({
        is_active: isActive,
        updated_at: updatedAt,
        updated_by: updatedBy,
      })
      .eq('id', id)
      .select(publicFields)
      .single();

    if (error) throw new InternalServerErrorException(error.message);
    return data;
  }

  // UPDATE USER
  async updateUser(id: string, update: Partial<User>) {
    const normalizedUpdate =
      update.class_id !== undefined || update.class_name !== undefined
        ? { ...update, ...this.normalizeUserClass(update) }
        : update;
    const { data, error } = await this.supabase
      .from('users')
      .update(normalizedUpdate)
      .eq('id', id)
      .select(publicFields)
      .single();

    if (error) throw new InternalServerErrorException(error.message);
    return data;
  }

  // DELETE USER (SOFT DELETE)
  async deleteUser(id: string, deletedBy: string) {
    const { data, error } = await this.supabase
      .from('users')
      .update({
        deleted_at: new Date(),
        deleted_by: deletedBy,
        is_active: false,
      })
      .eq('id', id)
      .select(publicFields)
      .single();

    if (error) throw new InternalServerErrorException(error.message);
    return data;
  }

  async bulkDeleteUsers(ids: string[], deletedBy: string) {
    const uniqueIds = [...new Set((ids || []).map((id) => String(id)).filter(Boolean))];

    if (uniqueIds.length === 0) {
      throw new BadRequestException('Pilih minimal satu pengguna untuk dihapus.');
    }

    const { data, error } = await this.supabase
      .from('users')
      .update({
        deleted_at: new Date(),
        deleted_by: deletedBy,
        is_active: false,
      })
      .in('id', uniqueIds)
      .is('deleted_at', null)
      .select('id');

    if (error) throw new InternalServerErrorException(error.message);

    return {
      success: true,
      count: data?.length || 0,
      message: `Berhasil menghapus ${data?.length || 0} pengguna.`,
    };
  }

  async issueInitialPassword(id: string) {
    const password = randomBytes(15).toString('base64url');
    const { data, error } = await this.supabase.from('users')
      .update({ password: await bcrypt.hash(password, 10), must_change_password: true })
      .eq('id', id).eq('role', 'SISWA').is('deleted_at', null).select('id').maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException('Siswa tidak ditemukan');
    return { password };
  }

  async replaceInitialPassword(id: string, previous: string, password: string) {
    const { data, error } = await this.supabase.from('users')
      .update({ password: await bcrypt.hash(password, 10), must_change_password: false })
      .eq('id', id).eq('password', previous).eq('must_change_password', true)
      .select('id').maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new BadRequestException('Silakan login kembali.');
  }

  // USERS BY ROLE
  async getUsersByRole(
    role: string,
    search: string,
    sort: string,
    order: 'asc' | 'desc',
    page: number,
    limit: number,
    examId?: string,
    user?: any,
  ) {
    const offset = (page - 1) * limit;

    const classIdentifiers = new Set<string>();

    const currentRole = String(user?.role || '').toUpperCase();

    if (currentRole === 'GURU' && !examId) {
      return {
        data: [],
        total: 0,
        page,
        limit,
        meta: { total: 0, page, limit, totalPages: 0 },
      };
    }

    if (examId) {
      const { data: exam, error: examError } = await this.supabase
        .from('exams')
        .select(
          `
          id,
          subject_id, assigned_teacher_id,
          subjects (
            class_id,
            teacher_id
          ),
          target_classes:exam_target_classes(class_id, class:classes(id,name))
        `,
        )
        .eq('id', examId)
        .single();

      if (examError || !exam) {
        throw new NotFoundException('Ujian tidak ditemukan');
      }

      const subject = Array.isArray(exam?.subjects) ? exam.subjects[0] : exam?.subjects;

      if (currentRole === 'GURU' && (exam.assigned_teacher_id ?? subject?.teacher_id) !== user?.sub) {
        throw new ForbiddenException('Anda tidak memiliki akses ke ujian ini.');
      }

      for (const target of exam?.target_classes || []) {
        const classRow: any = Array.isArray(target.class) ? target.class[0] : target.class;
        if (target.class_id) classIdentifiers.add(this.normalizeClassIdentifier(target.class_id));
        if (classRow?.name) classIdentifiers.add(this.normalizeClassIdentifier(classRow.name));
      }

      if (classIdentifiers.size === 0 && subject?.class_id) {
        classIdentifiers.add(this.normalizeClassIdentifier(subject.class_id));

        const { data: classRow, error: classError } = await this.supabase
          .from('classes')
          .select('id, name')
          .eq('id', subject.class_id)
          .is('deleted_at', null)
          .maybeSingle();

        if (classError) throw new InternalServerErrorException(classError.message);

        if (classRow?.id) classIdentifiers.add(this.normalizeClassIdentifier(classRow.id));
        if (classRow?.name) classIdentifiers.add(this.normalizeClassIdentifier(classRow.name));
      }
    }

    if (examId && classIdentifiers.size === 0) {
      return {
        data: [],
        total: 0,
        page,
        limit,
        meta: { total: 0, page, limit, totalPages: 0 },
      };
    }

    let query = this.supabase
      .from('users')
      .select(publicFields, { count: 'exact' })
      .eq('role', role)
      .is('deleted_at', null);

    if (search.trim()) {
      query = query.or(`name.ilike.%${search}%,userid.ilike.%${search}%,role.ilike.%${search}%,class_name.ilike.%${search}%`);
    }

    if (examId && classIdentifiers.size > 0) {
      const { data, error } = await query.order(sort, { ascending: order === 'asc' });

      if (error) throw new InternalServerErrorException(error.message);

      const filtered = (data || []).filter((student) => {
        const studentClassIdentifiers = [student.class_id, student.class_name]
          .map((value) => this.normalizeClassIdentifier(value))
          .filter(Boolean);

        return studentClassIdentifiers.some((identifier) => classIdentifiers.has(identifier));
      });

      const sorted = this.sortUsers(filtered, sort, order);
      const paged = sorted.slice(offset, offset + limit);

      return {
        data: paged,
        total: sorted.length,
        page,
        limit,
        meta: {
          total: sorted.length,
          page,
          limit,
          totalPages: Math.ceil(sorted.length / limit),
        },
      };
    }

    const { data, error, count } = await query
      .order(sort, { ascending: order === 'asc' })
      .range(offset, offset + limit - 1);

    if (error) throw new InternalServerErrorException(error.message);

    return {
      data,
      total: count,
      page,
      limit,
      meta: {
        total: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit),
      },
    };
  }
}
