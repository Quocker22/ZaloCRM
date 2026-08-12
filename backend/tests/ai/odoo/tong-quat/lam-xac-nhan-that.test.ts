// SPDX-License-Identifier: AGPL-3.0-or-later
// LỖ HỔNG "MODEL TỰ GẬT THAY NGƯỜI" — model một mình vượt phanh lam_odoo.
//
// ── ĐƯỜNG ĐI CỦA LỖ HỔNG (xác minh 11/08/2026) ────────────────────────────
// `lam_odoo` có hai phanh: XOÁ (unlink) và lệnh đụng >20 bản ghi thì trả
// `can_xac_nhan` thay vì chạy. Nhưng cờ vượt phanh `xac_nhan` được khai THẲNG
// trong `inputSchema` cho model tự điền:
//
//     xac_nhan: { type: 'boolean', description: 'true khi nhân viên ĐÃ đồng ý' }
//
// Vòng lặp tool-calling đẩy kết quả "cần xác nhận" NGƯỢC lại cho model rồi
// chạy tiếp TRONG CÙNG MỘT LƯỢT NHẮN. Model đọc chính câu cảnh báo nó vừa
// nhận, rồi gọi lại `lam_odoo` với `xac_nhan: true`. Nhân viên không kịp đọc,
// thậm chí không kịp THẤY — cả hai lần gọi nằm gọn trong một lượt, trước khi
// một chữ nào được gửi ra Zalo.
//
// Hậu quả thật: 300 đơn bị xoá mà không một con người nào gật. Odoo không có
// thùng rác, không hoàn tác được.
//
// ── VÌ SAO PHANH CŨ VÔ NGHĨA ──────────────────────────────────────────────
// Một cái phanh mà chính kẻ bị phanh tự nhả được thì không phải phanh. Nó chỉ
// là lời đề nghị, và model đã chứng minh nhiều lần nó lờ được lời đề nghị
// (bug 05/08 tao_don_nhap sau khi NV nói dừng; bug 10:09:33 11/08 giá 8đ).
//
// ── CÁCH BỊT: chìa khoá Symbol + đối chiếu tin NGƯỜI ở lượt SAU ────────────
// Đúng mẫu `CHIA_BO_PHANH` trong tools/tao-khach-hang.ts: Symbol KHÔNG
// serialize được qua JSON, nên input do LLM sinh không bao giờ mang được nó.
// Cờ `xac_nhan` chỉ có hiệu lực khi kèm chìa khoá, và chìa khoá chỉ do CODE
// đặt sau khi đọc tin THẬT của nhân viên ở lượt SAU (cùng cơ chế
// `giaLechDaXacNhan` bên máy gom đơn).
import { describe, it, expect, vi } from 'vitest';
import {
  lamOdoo,
  CHIA_XAC_NHAN,
  type LamOdooInput,
} from '../../../../src/modules/ai/odoo/tong-quat/lam.js';

function fake(soKhop = 1) {
  const searchRead = vi.fn(async () => Array.from({ length: soKhop }, (_, i) => ({ id: i + 1 })));
  const execute = vi.fn(async (_m: string, method: string) =>
    (method === 'search_count' ? soKhop : true));
  return { searchRead, execute };
}

describe('lam_odoo — model KHÔNG tự gật thay người được', () => {
  it('TÁI HIỆN LỖ HỔNG: model nhận "can_xac_nhan" rồi gọi lại xac_nhan:true trong CÙNG lượt → CHẶN', async () => {
    const odoo = fake(300);

    // Lượt 1 — model gọi lệnh xoá 300 đơn. Phanh bắt được.
    const lan1 = await lamOdoo({ odoo } as never, {
      bang: 'sale.order', viec: 'goi_nut', nut: 'unlink', loc: [['state', '=', 'draft']],
    });
    expect(lan1.trangThai).toBe('can_xac_nhan');

    // Lượt 2 — VẪN TRONG CÙNG MỘT LƯỢT NHẮN. Model đọc câu cảnh báo nó vừa
    // nhận rồi tự điền xac_nhan:true. Đây CHÍNH LÀ input JSON mà LLM sinh ra:
    // JSON thuần, không có Symbol, vì Symbol không đi qua JSON được.
    const inputLlmBiaRa = JSON.parse(JSON.stringify({
      bang: 'sale.order', viec: 'goi_nut', nut: 'unlink',
      loc: [['state', '=', 'draft']], xac_nhan: true,
    })) as LamOdooInput;

    const lan2 = await lamOdoo({ odoo } as never, inputLlmBiaRa);

    // Cờ do model tự điền KHÔNG được coi là người gật.
    expect(lan2.trangThai).toBe('can_xac_nhan');
    // Và quan trọng nhất: KHÔNG một lệnh xoá nào chạm tới Odoo.
    expect(odoo.execute.mock.calls.some((c) => c[1] === 'unlink')).toBe(false);
  });

  it('model tự gật lệnh HÀNG LOẠT (>20) cũng bị chặn y hệt', async () => {
    const odoo = fake(1257);
    const input = JSON.parse(JSON.stringify({
      bang: 'product.product', viec: 'sua',
      loc: [['id', '>', 0]], du_lieu: { name: 'x' }, xac_nhan: true,
    })) as LamOdooInput;

    const kq = await lamOdoo({ odoo } as never, input);
    expect(kq.trangThai).toBe('can_xac_nhan');
    expect(odoo.execute.mock.calls.some((c) => c[1] === 'write')).toBe(false);
  });

  it('schema KHÔNG còn khai xac_nhan — model không được mời tự điền', async () => {
    const { lamOdooDefinition } = await import(
      '../../../../src/modules/ai/odoo/tong-quat/lam.js'
    );
    const props = lamOdooDefinition.inputSchema.properties ?? {};
    expect(Object.keys(props)).not.toContain('xac_nhan');
  });

  it('NGƯỜI THẬT gật ở lượt SAU (có chìa khoá Symbol) → CHO QUA, tính năng còn nguyên', async () => {
    const odoo = fake(47);
    // Chìa khoá do CODE đặt sau khi đọc tin thật "đồng ý" của nhân viên ở lượt
    // sau — LLM không sinh ra được vì Symbol không qua JSON.
    const kq = await lamOdoo({ odoo } as never, {
      bang: 'sale.order', viec: 'goi_nut', nut: 'unlink',
      loc: [['state', '=', 'draft']],
      xac_nhan: true,
      [CHIA_XAC_NHAN]: true,
    });
    expect(kq.trangThai).toBe('da_lam');
    expect(odoo.execute.mock.calls.some((c) => c[1] === 'unlink')).toBe(true);
  });

  it('chìa khoá mà KHÔNG có cờ xac_nhan → vẫn phanh (chìa không tự nó là lời gật)', async () => {
    const odoo = fake(47);
    const kq = await lamOdoo({ odoo } as never, {
      bang: 'sale.order', viec: 'goi_nut', nut: 'unlink',
      loc: [['state', '=', 'draft']],
      [CHIA_XAC_NHAN]: true,
    });
    expect(kq.trangThai).toBe('can_xac_nhan');
    expect(odoo.execute.mock.calls.some((c) => c[1] === 'unlink')).toBe(false);
  });

  it('Symbol KHÔNG đi qua JSON — chứng minh nền tảng của cách bịt này', () => {
    const coChia = { bang: 'sale.order', xac_nhan: true, [CHIA_XAC_NHAN]: true };
    const quaJson = JSON.parse(JSON.stringify(coChia)) as Record<string | symbol, unknown>;
    // Đây là đúng thứ xảy ra với input LLM: nó luôn đi qua JSON.
    expect(quaJson[CHIA_XAC_NHAN]).toBeUndefined();
    expect(quaJson.xac_nhan).toBe(true);
  });
});
