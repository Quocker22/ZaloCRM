// SPDX-License-Identifier: AGPL-3.0-or-later
// dieuPhoiPhien — lượt LLM bật suy nghĩ riêng, đầu ra bắt buộc là tool; code
// giữ luật (fail-open, không tin output rác), kho phiên có dự phòng bộ nhớ.
import { describe, it, expect, vi } from 'vitest';
import { dieuPhoiPhien } from '../../../../src/modules/ai/agent/dieu-phoi/dieu-phoi.js';
import { phienTrong } from '../../../../src/modules/ai/agent/dieu-phoi/phien-don.js';
import { docPhienDon, luuPhienDon, xoaPhienDon } from '../../../../src/modules/ai/agent/dieu-phoi/kho-phien.js';
import type { AgentTurn } from '../../../../src/modules/ai/agent/types.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
const turnTool = (input: Record<string, unknown>): AgentTurn => ({
  text: '', stopReason: 'tool_use', raw: null, usage, toolCalls: [{ id: 'd1', name: 'cap_nhat_phien', input }],
});

describe('dieuPhoiPhien', () => {
  it('ca thật 16:23 26/08 (ảnh hoá đơn cũ + "20m mỗi loại"): gọi model với suyNghi=true, ô/dòng vào phiên, canHoi rỗng, đủ để lên đơn', async () => {
    const generate = vi.fn(async () => turnTool({
      y_dinh: 'dat_hang', che: 'dat_hang',
      khach: { trangThai: 'da_co', giaTri: { ten: 'QC Hoàng Nguyên', sdt: '0989271275' } },
      dong: [
        { ten: 'Vỏ Neon 6mm Xanh Ngọc (50m/c)', soLuong: { trangThai: 'da_co', giaTri: 20 }, donGia: { trangThai: 'da_co', giaTri: 9000 }, donVi: 'm' },
        { ten: 'Led Dây chữ S 6mm 120 Led 1M xanh ngọc', soLuong: { trangThai: 'da_co', giaTri: 20 }, donGia: { trangThai: 'da_co', giaTri: 12000 }, donVi: 'm' },
      ],
      luu_y: 'khách lấy lại đơn cũ nhưng đổi SL 30→20',
    }));
    const kq = await dieuPhoiPhien(generate, {
      phien: phienTrong('nhanvien'),
      cauMoi: '[Khách gửi ảnh: hoá đơn INV/2026/028232 …] lên đơn như này nhưng số lượng 20m mỗi loại',
      lichSu: [],
    });
    expect(kq.nguon).toBe('llm');
    expect(kq.yDinh).toBe('dat_hang');
    expect(kq.phien.dong.map((d) => d.soLuong.giaTri)).toEqual([20, 20]);
    expect(kq.phien.dong.map((d) => d.donGia.giaTri)).toEqual([9000, 12000]);
    expect(kq.canHoi).toEqual([]);
    expect(kq.duDeLenDon).toBe(true);
    expect(kq.luuY).toContain('30→20');
    const goi = generate.mock.calls[0][0];
    expect(goi.suyNghi).toBe(true);
    expect(goi.tools.map((t) => t.name)).toEqual(['cap_nhat_phien']);
    expect(String(goi.messages[0].content)).toContain('PHIÊN HIỆN TẠI');
  });

  it('khách nói "lấy 10 cái" chưa nói khách/hàng gì → canHoi = [khach, dong]; lượt sau chỉ ô đổi, ô cũ giữ', async () => {
    const g1 = vi.fn(async () => turnTool({ y_dinh: 'dat_hang', che: 'dat_hang', dong: [{ ten: 'cái đó', soLuong: { trangThai: 'da_co', giaTri: 10 }, donGia: { trangThai: 'thieu' } }] }));
    const a = await dieuPhoiPhien(g1, { phien: phienTrong('khach'), cauMoi: 'lấy 10 cái', lichSu: [] });
    expect(a.canHoi.map((c) => c.o)).toEqual(['khach', 'giaoHang']);
    const g2 = vi.fn(async () => turnTool({ y_dinh: 'dat_hang', che: 'dat_hang', khach: { trangThai: 'da_co', giaTri: { ten: 'Long', sdt: '0912' } } }));
    const b = await dieuPhoiPhien(g2, { phien: a.phien, cauMoi: 'Long 0912', lichSu: [] });
    expect(b.phien.dong).toHaveLength(1); // dòng cũ giữ nguyên vì model không nhắc tới
    expect(b.canHoi.map((c) => c.o)).toEqual(['giaoHang', 'thanhToan']);
  });

  it('model TIMEOUT / không gọi tool / ném lỗi → phiên cũ nguyên vẹn, nguon=loi, không ném', async () => {
    const p = phienTrong('khach'); p.che = 'dat_hang';
    const treo = vi.fn(() => new Promise<AgentTurn>(() => {}));
    const a = await dieuPhoiPhien(treo, { phien: p, cauMoi: 'x', lichSu: [] }, 30);
    expect(a.nguon).toBe('loi'); expect(a.phien).toEqual(p);
    const text = vi.fn(async (): Promise<AgentTurn> => ({ text: 'Dạ…', stopReason: 'end_turn', raw: null, usage, toolCalls: [] }));
    expect((await dieuPhoiPhien(text, { phien: p, cauMoi: 'x', lichSu: [] })).nguon).toBe('loi');
    const nem = vi.fn(async () => { throw new Error('429'); });
    expect((await dieuPhoiPhien(nem, { phien: p, cauMoi: 'x', lichSu: [] })).nguon).toBe('loi');
  });
});

describe('kho phiên (không có REDIS_URL → bộ nhớ)', () => {
  it('lưu/đọc/xoá; đọc phiên trống khi chưa có; vai lấy theo caller', async () => {
    delete process.env.REDIS_URL;
    const id = 'conv-test-' + Math.random();
    expect((await docPhienDon(id, 'khach')).che).toBe('khong');
    const p = phienTrong('nhanvien'); p.che = 'dat_hang';
    await luuPhienDon(id, p);
    const doc = await docPhienDon(id, 'khach');
    expect(doc.che).toBe('dat_hang');
    expect(doc.vai).toBe('khach');
    await xoaPhienDon(id);
    expect((await docPhienDon(id, 'khach')).che).toBe('khong');
  });
});
