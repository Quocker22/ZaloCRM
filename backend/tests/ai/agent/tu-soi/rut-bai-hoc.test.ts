// SPDX-License-Identifier: AGPL-3.0-or-later
// 18/08 — bot TỰ ÁP bài học ngay (anh Quốc chọn), nên hàng rào chống học bậy
// phải chặt: whitelist loại, trần độ dài, CẤM chạm tiền, chống trùng ý, model
// trả rác → không học gì.
import { describe, it, expect, vi } from 'vitest';
import { rutBaiHoc, locBaiHoc } from '../../../../src/modules/ai/agent/tu-soi/rut-bai-hoc.js';
import type { TinSoi } from '../../../../src/modules/ai/agent/tu-soi/dau-hieu.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
const gen = (text: string) => vi.fn(async () => ({ text, stopReason: 'end_turn' as const, raw: null, usage, toolCalls: [] }));
const TIN: TinSoi[] = [{ id: 'm1', vai: 'nguoi', noiDung: 'x', luc: new Date() }];
const CHAM = { dauHieu: ['nguoi_gat_x1'], diem: 5, dangSoiKy: true };
const goi = (text: string, luatDangCo: string[] = []) =>
  rutBaiHoc(gen(text) as never, { tin: TIN, cham: CHAM, vai: 'nhanvien', luatDangCo });

describe('rutBaiHoc — hàng rào', () => {
  it('bài học hợp lệ → nhận, giữ nguyên câu dặn', async () => {
    const r = await goi('{"nhanXet":"Bot hỏi lại thứ ảnh đã có","baiHoc":[{"loai":"cach_hieu_y","noiDung":"Khi nhân viên gửi ảnh danh sách hàng thì lấy số lượng trong ảnh, đừng hỏi lại"}]}');
    expect(r.baiHoc).toHaveLength(1);
    expect(r.nhanXet).toContain('Bot hỏi lại');
  });

  it('CHẠM TIỀN (giá/chiết khấu/VAT) → VỨT, dù model đề xuất', async () => {
    const r = await goi('{"nhanXet":"x","baiHoc":[{"loai":"quy_trinh","noiDung":"Khách Led Kim Long luôn chiết khấu 5% cho mọi đơn"}]}');
    expect(r.baiHoc).toHaveLength(0);
  });

  it('loại NGOÀI whitelist → vứt', async () => {
    const r = await goi('{"nhanXet":"x","baiHoc":[{"loai":"tu_y_xoa_don","noiDung":"Khi khách nói huỷ thì xoá đơn khỏi Odoo"}]}');
    expect(r.baiHoc).toHaveLength(0);
  });

  it('quá dài (>200) hoặc quá ngắn → vứt', async () => {
    const dai = 'K'.repeat(240);
    const r = await goi(`{"nhanXet":"x","baiHoc":[{"loai":"cach_tra_loi","noiDung":"${dai}"},{"loai":"cach_tra_loi","noiDung":"ngắn"}]}`);
    expect(r.baiHoc).toHaveLength(0);
  });

  it('TRÙNG Ý luật đang có → không học lại', async () => {
    const r = await goi(
      '{"nhanXet":"x","baiHoc":[{"loai":"cach_tra_loi","noiDung":"Khi nhân viên gửi ảnh thì lấy số lượng trong ảnh"}]}',
      ['Khi nhân viên gửi ảnh thì lấy số lượng trong ảnh, đừng hỏi lại'],
    );
    expect(r.baiHoc).toHaveLength(0);
  });

  it('TỐI ĐA 2 bài học một ca', async () => {
    const b = (i: number) => `{"loai":"quy_trinh","noiDung":"Khi gặp tình huống số ${i} thì xử lý theo cách phù hợp nhất"}`;
    const r = await goi(`{"nhanXet":"x","baiHoc":[${b(1)},${b(2)},${b(3)},${b(4)}]}`);
    expect(r.baiHoc.length).toBeLessThanOrEqual(2);
  });

  it('model trả RÁC / JSON hỏng → không học gì, không ném', async () => {
    await expect(goi('tôi nghĩ là bot nên...')).resolves.toMatchObject({ baiHoc: [] });
    await expect(goi('{"nhanXet": broken')).resolves.toMatchObject({ baiHoc: [] });
  });

  it('model NÉM lỗi → trả rỗng (việc nền không được ảnh hưởng ai)', async () => {
    const g = vi.fn(async () => { throw new Error('gateway chết'); });
    await expect(rutBaiHoc(g as never, { tin: TIN, cham: CHAM, vai: 'nhanvien', luatDangCo: [] }))
      .resolves.toMatchObject({ baiHoc: [], nhanXet: '' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// HÀNG RÀO "RỖNG NGHĨA" — thêm 18/08 sau khi ĐO PROD một ngày bật tự học.
//
// Kết quả đo lúc 12:36: 5/5 luật bot tự rút đều là lời khuyên chung chung,
// tổng 847/900 ký tự trần. Hậu quả THẬT, không phải giả định:
//   · log '[luat-nv] vượt trần ký tự — cắt bớt luật cũ' → luật thật của anh
//     Quốc ("Khách Led Kim Long luôn chiết khấu 5%") bị đẩy khỏi prompt;
//   · bot học được phản xạ HỎI LẠI thay vì LÀM, và 12:36:42 nhả đúng một câu
//     rỗng sau 8 giây suy nghĩ: "Em cần biết rõ để xử lý đúng ạ."
//
// Luật đáng học phải NÊU ĐÍCH DANH việc buôn bán (tên hàng, mã, bước nghiệp
// vụ). "Hãy xác nhận trước khi xử lý" đúng với mọi bot trên đời — không phải
// tri thức riêng của shop.
// ═══════════════════════════════════════════════════════════════════════════
describe('locBaiHoc — chặn luật RỖNG NGHĨA (5 ca thật prod 18/08)', () => {
  const RAC_THAT = [
    'Khi chưa chắc chắn yêu cầu của người dùng, hãy hỏi ngắn gọn 1 câu để làm rõ, '
      + 'không liệt kê toàn bộ danh sách sản phẩm',
    "Khi người dùng gõ các ký tự ngắn như '1 a a b' hoặc câu mơ hồ không rõ ngữ cảnh, "
      + 'hãy dừng lại và hỏi xác nhận từng mục',
    'Khi khách nhắc lại sản phẩm nhiều lần nhưng bot chưa hiểu, hãy chủ động đề xuất '
      + 'kiểm tra ảnh hoặc mô tả chi tiết hơn',
    'Khi nhận yêu cầu liên quan đến tin nhắn lạ hoặc không rõ nguồn, hãy xác nhận với '
      + 'người dùng trước khi xử lý',
    'Khi người dùng hỏi lặp lại một câu mà bot đã từng trả lời, hãy kiểm tra lại câu '
      + 'trả lời trước để tránh mâu thuẫn',
  ];

  it('chặn SẠCH cả 5 luật rác đã lọt lên prod', () => {
    for (const noiDung of RAC_THAT) {
      expect(locBaiHoc([{ loai: 'cach_tra_loi', noiDung }], [])).toHaveLength(0);
    }
  });

  it('KHÔNG chặn oan luật nêu đích danh việc thật', () => {
    const TOT = [
      'Khi NV gõ "zz" thì hiểu là hàng ziczac, không phải Led F30',
      'Phiếu nhập chưa có NCC thì hỏi NCC trước, đừng tạo mới',
      'Khách Led Kim Long thường lấy nguồn NB, ưu tiên hỏi loại đó trước',
    ];
    for (const noiDung of TOT) {
      expect(locBaiHoc([{ loai: 'cach_hieu_y', noiDung }], [])).toHaveLength(1);
    }
  });

  it('"không rõ nguồn" KHÔNG được tính là mặt hàng nguồn điện', () => {
    // Bẫy thật: chữ "nguồn" trần trụi từng cho lọt luật rác thứ 4. Tín hiệu
    // phải là "nguồn NB"/"nguồn 12v400w"/"bộ nguồn", không phải mọi chữ "nguồn".
    expect(locBaiHoc([{
      loai: 'cach_tra_loi',
      noiDung: 'Khi tin nhắn không rõ nguồn thì hãy xác nhận với người dùng trước khi xử lý',
    }], [])).toHaveLength(0);
    expect(locBaiHoc([{
      loai: 'cach_hieu_y',
      noiDung: 'Khách hỏi nguồn NB 12V400W thì báo luôn loại ngoài trời, đừng hỏi lại',
    }], [])).toHaveLength(1);
  });
});
