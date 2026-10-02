// SPDX-License-Identifier: AGPL-3.0-or-later
// luat.ts — ô đích trong panel theo BA kiểu composer (Codex v2 #1) + nhóm khách bot chưa hỗ trợ (Codex v2 #6).
import { describe, it, expect } from 'vitest';
import { anhChupMau } from './client-mau';
import { DICH_LUAT } from './cau-hinh';
import { dichLuatTuHang } from './chuyen-doi';
import { dichKhoa, dsDichPanel, kiemDich } from './luat';

const a = anhChupMau();
const c = (id: string) => a.composer.find((x) => x.id === id)!;
/** = lednelia-agent thong_bao/dong_bo_luat.py CHUC_NANG — chức năng nhóm bot nhận làm đích. */
const CHUC_NANG_BOT = new Set(['admin', 'kho', 'ke_toan', 'sales']);

describe('luat.ts — ba kiểu composer', () => {
  it('khoa: chỉ nơi gốc, khoá kèm lý do', () => {
    expect(dsDichPanel(c('the_xem_truoc'), [])).toEqual(['nhom_goc']);
    expect(dichKhoa(c('the_xem_truoc'), 'nhom_goc')).toMatch(/^Đích cố định/);
  });
  it('ban_sao: nơi gốc 🔒 "luôn nhận"; hàng luật tick được', () => {
    expect(dichKhoa(c('da_chot'), 'nhom_goc')).toMatch(/Nơi gốc luôn nhận/);
    expect(dichKhoa(c('da_chot'), 'g_ketoan')).toBeNull();
  });
  it('thuan: KHÔNG khoá dich_goc (chỉ là gợi ý) — Kho của in_xong tick được; danh sách = gợi ý + hàng luật', () => {
    expect(dichKhoa(c('in_xong'), 'g_kho')).toBeNull();
    expect(dsDichPanel(c('in_xong'), [])).toEqual([...new Set(['g_kho', ...DICH_LUAT])]);
  });
});

describe('nhóm khách — bot chưa hỗ trợ (Codex v2 #6)', () => {
  it('composer KHÔNG nhạy cảm vẫn bị chặn ô nhóm khách, lý do "Bot chưa hỗ trợ gửi nhóm khách"; nhạy cảm giữ lý do nhạy cảm', () => {
    expect(kiemDich(c('in_xong'), 'g_khach')?.chan).toBe('Bot chưa hỗ trợ gửi nhóm khách.');
    expect(kiemDich(c('da_chot'), 'g_khach')?.chan).toMatch(/cấm vào nhóm khách/);
  });
  it('XUYÊN HỢP ĐỒNG UI → CRM → bot: mọi ô tick được (không chặn, không khoá) chỉ sinh chức năng bot nhận', () => {
    for (const comp of a.composer.filter((x) => x.kieu !== 'khoa')) {
      for (const d of dsDichPanel(comp, [])) {
        if (dichKhoa(comp, d) || kiemDich(comp, d)?.chan) continue;
        const api = dichLuatTuHang(d);
        if (api?.kieu === 'chuc_nang') expect(CHUC_NANG_BOT.has(api.gia_tri!), `${comp.id}→${d}`).toBe(true);
      }
    }
  });
});
