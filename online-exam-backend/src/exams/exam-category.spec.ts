import { BadRequestException, ConflictException } from '@nestjs/common';
import { ExamCategoryService } from './exam-category.service';
import { ExamService } from './exam.service';

const categoryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('exam categories', () => {
  it('normalizes names and reports duplicate categories', async () => {
    const single = jest.fn().mockResolvedValueOnce({ data: { id: categoryId, name: 'ATS Ganjil 2026–2027' }, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: '23505' } });
    const insert = jest.fn().mockReturnValue({ select: () => ({ single }) });
    const service = new ExamCategoryService({ from: () => ({ insert }) } as any);

    await service.create('  ATS   Ganjil 2026–2027  ', 'admin-id');
    expect(insert).toHaveBeenCalledWith({ name: 'ATS Ganjil 2026–2027', created_by: 'admin-id' });
    await expect(service.create('ats ganjil 2026–2027', 'admin-id')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.create('   ', 'admin-id')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('filters before pagination and preserves the filtered count', async () => {
    const query: any = {
      select: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockResolvedValue({ data: [], count: 17, error: null }),
    };
    const categories = { assertExists: jest.fn().mockResolvedValue(undefined) };
    const service = new ExamService({ from: () => query } as any, {} as any, categories as any);

    const result = await service.getDataWithPagination('', 'title', 'asc', 2, 10, { role: 'ADMIN' }, categoryId);
    expect(categories.assertExists).toHaveBeenCalledWith(categoryId);
    expect(query.eq).toHaveBeenCalledWith('category_id', categoryId);
    expect(query.range).toHaveBeenCalledWith(10, 19);
    expect(result.meta).toEqual({ total: 17, page: 2, limit: 10, totalPages: 2 });

    await service.getDataWithPagination('', 'title', 'asc', 1, 10, { role: 'ADMIN' }, 'uncategorized');
    expect(query.is).toHaveBeenCalledWith('category_id', null);
  });

  it('requires a category for every new exam', async () => {
    const service = new ExamService({} as any, {} as any, {} as any);
    await expect(service.create({ category_id: '' } as any)).rejects.toBeInstanceOf(BadRequestException);
  });
});
