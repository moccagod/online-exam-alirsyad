import { BadRequestException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { ClassesService } from './classes.service';

describe('ClassesService.create', () => {
  const actor = '00000000-0000-0000-0000-000000000001';

  function setup(existing: { id: string; deleted_at: string | null } | null) {
    const maybeSingle = jest.fn().mockResolvedValue({ data: existing, error: null });
    const single = jest.fn().mockResolvedValue({
      data: { id: '12AK', name: '12 Akuntansi', grade: 12, deleted_at: null },
      error: null,
    });
    const query = {
      select: jest.fn(),
      eq: jest.fn(),
      not: jest.fn(),
      maybeSingle,
      single,
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.not.mockReturnValue(query);
    const update = jest.fn().mockReturnValue(query);
    const insert = jest.fn().mockReturnValue(query);
    const from = jest.fn().mockReturnValue({ ...query, update, insert });
    const service = new ClassesService({ from } as unknown as SupabaseClient);
    return { service, from, update, insert, query };
  }

  it('reactivates a deleted code with the corrected grade', async () => {
    const { service, update, insert, query } = setup({
      id: '12AK',
      deleted_at: '2026-11-27T00:00:00Z',
    });

    await expect(service.create({ id: '12ak', name: '12 Akuntansi', grade: '12' }, actor))
      .resolves.toMatchObject({ id: '12AK', grade: 12, deleted_at: null });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      name: '12 Akuntansi',
      grade: 12,
      deleted_at: null,
      deleted_by: null,
      updated_by: actor,
    }));
    expect(query.not).toHaveBeenCalledWith('deleted_at', 'is', null);
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects an active code', async () => {
    const { service, update, insert } = setup({ id: '12AK', deleted_at: null });

    await expect(service.create({ id: '12AK', name: '12 Akuntansi', grade: 12 }, actor))
      .rejects.toThrow(BadRequestException);
    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('inserts a new code', async () => {
    const { service, update, insert } = setup(null);

    await service.create({ id: '12AK', name: '12 Akuntansi', grade: 12 }, actor);
    expect(insert).toHaveBeenCalledWith({
      id: '12AK', name: '12 Akuntansi', grade: 12, created_by: actor,
    });
    expect(update).not.toHaveBeenCalled();
  });
});
