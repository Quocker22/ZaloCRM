// SPDX-License-Identifier: AGPL-3.0-or-later
// docs/79 T1 — cột 4 (ChatContactPanel): saveContact CHỈ gửi `gender` khi ô giới tính đổi; nút "Xác nhận" gửi xacNhanGioi.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import type { Contact } from './use-contacts';

const updateContact = vi.fn(async (_id: string, _p: Record<string, unknown>) => ({}) as Contact);
let ban: Partial<Contact>;
const fetchContact = vi.fn(async () => ({ ...ban }) as Contact);
vi.mock('@/composables/use-contacts', () => ({ useContacts: () => ({ updateContact, fetchContact }) }));
vi.mock('@/api/index', () => ({ api: { get: vi.fn(async () => ({ data: { appointments: [] } })) } }));

import { useChatContactPanel } from './use-chat-contact-panel';

const cho = async () => { for (let i = 0; i < 5; i++) { await nextTick(); await Promise.resolve(); } };

describe('useChatContactPanel — giới tính', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ban = { id: 'c1', fullName: 'Khách', phone: '0900', gender: 'male', gioiTinhXacNhanLuc: null } as Partial<Contact>;
  });

  async function dung() {
    const p = useChatContactPanel(() => 'c1', () => ban as Contact, () => {});
    await cho();
    return p;
  }

  it('sửa SĐT rồi lưu ⇒ KHÔNG gửi gender', async () => {
    const p = await dung();
    p.form.phone = '0911';
    await p.saveContact();
    expect(updateContact).toHaveBeenCalledTimes(1);
    expect(updateContact.mock.calls[0][1]).not.toHaveProperty('gender');
    expect(updateContact.mock.calls[0][1]).toMatchObject({ phone: '0911' });
  });

  it('đổi ô giới tính ⇒ gửi gender mới; trạng thái "đã xác nhận" theo dấu backend trả', async () => {
    const p = await dung();
    expect(p.trangThaiGioiTinh.value).toBe('chua_xac_nhan');
    p.form.gender = 'female';
    ban = { ...ban, gender: 'female', gioiTinhXacNhanLuc: '2026-10-02T01:00:00Z' } as Partial<Contact>;
    await p.saveContact();
    expect(updateContact.mock.calls[0][1]).toMatchObject({ gender: 'female' });
    await cho();
    expect(p.trangThaiGioiTinh.value).toBe('da_xac_nhan');
    // Lưu tiếp (không đổi giới) ⇒ lại không gửi gender.
    p.form.notes = 'x';
    await p.saveContact();
    expect(updateContact.mock.calls[1][1]).not.toHaveProperty('gender');
  });

  it('nút "Xác nhận" ⇒ gửi đúng {gender, xacNhanGioi: true}', async () => {
    const p = await dung();
    await p.xacNhanGioiTinh();
    expect(updateContact).toHaveBeenCalledWith('c1', { gender: 'male', xacNhanGioi: true });
  });
});
