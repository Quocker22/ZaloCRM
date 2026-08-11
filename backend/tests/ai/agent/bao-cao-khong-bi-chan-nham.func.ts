// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: BÁO CÁO có Excel thật KHÔNG được hàng rào chống-hứa-lèo vứt đi.
//
// CA THẬT 21:47:52 và 21:50:21 ngày 11/08/2026 — anh Quốc: "ủa này là sao":
//
//   NV : "@bot báo cáo các sản phẩm bán ra hôm nay"
//   Bot: "Dạ khoản này em chưa xử lý được, anh/chị xem giúp em với ạ."
//
// Bot ĐÃ LÀM ĐÚNG: tra ra ngày đúng (11/08/2026) và số mã đúng (7 mã, khớp
// kiểm chứng prod), sinh file Excel thật. Nhưng hàng rào `khoeDaGuiTaiLieu` chỉ
// đối chiếu với `taiLieuDaLay` (tool `gui_tai_lieu`) nên tưởng bot bịa:
//
//   lyDo: 'Model nói đã gửi tài liệu ("Dạ, báo cáo theo ngày hôm nay
//          (11/08/2026) có 7 mã sản phẩm bán ra, xếp theo số ") nhưng KHÔNG
//          file nào được lấy về.'
//
// Excel báo cáo đi đường KHÁC: tool báo cáo tự sinh qua `xuatExcel` →
// `tepBaoCao` → `guiFile` ở luong-nhan-vien.ts. Không hề đụng `gui_tai_lieu`.
//
// VÌ SAO PHẢI TEST Ở TẦNG NÀY chứ không chỉ unit test hàm nhận diện: bug nằm ở
// chỗ WIRING — hàm `khoeDaGuiTaiLieu` nhận diện đúng y như thiết kế, cái sai là
// caller đối chiếu với sai bằng chứng. Test hàm đơn lẻ không bao giờ thấy.
//
// SỐ ĐO PROD 24h (docker logs zalo-crm-app --since 24h, 11/08/2026): 71 dòng
// luồng nhân viên, 3 lượt bị chặn "dở dang", 3/3 đều là CHẶN NHẦM ca báo cáo
// này, 0 lượt bắt được ca bịa thật.
import { describe, it, expect, vi } from 'vitest';
import { chayLenhNhanVien } from '../../../src/modules/ai/agent/staff-agent.js';
import type { AgentTurn } from '../../../src/modules/ai/agent/types.js';
import type { OdooClient } from '../../../src/modules/ai/odoo/client.js';

/**
 * Odoo giả trả về 7 mã bán ra — đúng con số ca thật 11/08 (khớp kiểm chứng prod).
 * `bao_cao_ban_ton` gọi read_group qua execute.
 */
const odooBaoCao = () =>
  ({
    searchRead: vi.fn(async () => []),
    execute: vi.fn(async (model: string, method: string) => {
      if (method === 'read_group') {
        return Array.from({ length: 7 }, (_, i) => ({
          product_id: [100 + i, `San pham ${i + 1}`],
          product_uom_qty: 10 - i,
          price_subtotal: (10 - i) * 50_000,
          __count: 1,
        }));
      }
      return [];
    }),
  }) as unknown as OdooClient;

const luot = (turns: AgentTurn[]) => {
  let i = 0;
  return vi.fn(async () => turns[Math.min(i++, turns.length - 1)]);
};

const goiTool = (name: string, input: Record<string, unknown>): AgentTurn => ({
  text: '',
  toolCalls: [{ id: 't1', name, input }],
  stopReason: 'tool_use',
  raw: [{ type: 'tool_use', id: 't1', name, input }],
});

const ketThuc = (text: string): AgentTurn => ({
  text, toolCalls: [], stopReason: 'end_turn', raw: [{ type: 'text', text }],
});

const chay = (turns: AgentTurn[], odoo: OdooClient = odooBaoCao()) =>
  chayLenhNhanVien(
    { odoo, generate: luot(turns), ghiNhanChuyenSale: vi.fn(async () => {}) },
    {
      bizName: 'LEDNELIA', conversationId: 'conv-bao-cao', seq: 0,
      message: { content: '@bot báo cáo các sản phẩm bán ra hôm nay', isSelf: true },
    },
  );

/** Câu THẬT bot trả lúc 21:47:52 ngày 11/08/2026 (trích từ log prod). */
const CAU_THAT_2147 =
  'Dạ, báo cáo theo ngày hôm nay (11/08/2026) có 7 mã sản phẩm bán ra, xếp theo số lượng bán';

describe('CA THẬT 21:47:52 11/08 — báo cáo sinh Excel thật thì phải TRẢ VỀ NHÂN VIÊN', () => {
  it('BUG GỐC: câu trả lời đúng + có Excel → xong, KHÔNG bị chặn "dở dang"', async () => {
    const r = await chay([
      goiTool('bao_cao_ban_ton', { ky: 'hom_nay' }),
      ketThuc(CAU_THAT_2147),
    ]);

    // Trước bản vá: 'chua_hoan_tat' với lyDo "KHÔNG file nào được lấy về" →
    // nhân viên nhận "Dạ khoản này em chưa xử lý được".
    expect(r.trangThai).toBe('xong');
    if (r.trangThai !== 'xong') return;
    expect(r.traLoi).toBe(CAU_THAT_2147);
  });

  it('file Excel THẬT được đính kèm để luong-nhan-vien.ts gửi đi', async () => {
    const r = await chay([
      goiTool('bao_cao_ban_ton', { ky: 'hom_nay' }),
      ketThuc(CAU_THAT_2147),
    ]);

    if (r.trangThai !== 'xong') throw new Error('sai nhánh: ' + r.trangThai);
    expect(r.tepBaoCao?.length ?? 0).toBeGreaterThan(0);
  });

  it('bot nói thẳng "em gửi file Excel" + có Excel thật → vẫn cho qua', async () => {
    const r = await chay([
      goiTool('bao_cao_ban_ton', { ky: 'hom_nay' }),
      ketThuc('Dạ em gửi file Excel báo cáo bán ra hôm nay cho anh ạ, có 7 mã'),
    ]);

    expect(r.trangThai).toBe('xong');
  });

  it('bot nói "em gửi ảnh báo cáo" + có đính kèm thật → cho qua (hàng rào ẢNH cùng bệnh)', async () => {
    const r = await chay([
      goiTool('bao_cao_ban_ton', { ky: 'hom_nay' }),
      ketThuc('Dạ em gửi ảnh báo cáo bán ra hôm nay cho anh xem ạ'),
    ]);

    expect(r.trangThai).toBe('xong');
  });
});

describe('CHỨC NĂNG CHÍNH GIỮ NGUYÊN — bot bịa vẫn bị chặn', () => {
  it('nói "em đã gửi tài liệu" mà KHÔNG gọi tool nào → VẪN CHẶN', async () => {
    const r = await chay([ketThuc('Dạ em đã gửi tài liệu kỹ thuật P10 cho anh rồi ạ')]);

    expect(r.trangThai).toBe('chua_hoan_tat');
    if (r.trangThai !== 'chua_hoan_tat') return;
    expect(r.lyDo).toContain('tài liệu');
  });

  it('nói "em gửi file Excel" mà KHÔNG chạy tool báo cáo nào → VẪN CHẶN', async () => {
    // Ca nguy hiểm nhất khi nới hàng rào: không được nới thành "cứ nói file là qua".
    const r = await chay([ketThuc('Dạ em gửi file Excel báo cáo cho anh nhé')]);

    expect(r.trangThai).toBe('chua_hoan_tat');
  });

  it('nói "em gửi lại ảnh đơn hàng" mà chạy 0 tool → VẪN CHẶN (bug 07/08 DNH36805)', async () => {
    const r = await chay([ketThuc('Dạ, em gửi lại ảnh đơn hàng DNH36805 cho anh ạ')]);

    expect(r.trangThai).toBe('chua_hoan_tat');
    if (r.trangThai !== 'chua_hoan_tat') return;
    expect(r.lyDo).toContain('ảnh');
  });

  it('tra cứu bình thường, không khoe gửi gì → xong như cũ', async () => {
    const r = await chay([
      goiTool('bao_cao_ban_ton', { ky: 'hom_nay' }),
      ketThuc('Dạ hôm nay có 7 mã sản phẩm bán ra ạ'),
    ]);

    expect(r.trangThai).toBe('xong');
  });
});
