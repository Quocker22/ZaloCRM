// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: tool gui_tai_lieu — GỬI FILE PDF thật khi khách/nhân viên xin.
//
// BUG THẬT tái hiện ở đây (nhóm, 03:17-03:18 ngày 11/08/2026):
//
//   03:17:16 bot: "hệ thống em đang chỉ tra được nội dung thông số kỹ thuật
//                  trong catalog (bản văn bản/tài liệu nhà sản xuất),
//                  hiện chưa có sẵn file"
//   03:17:58 NV : "a muốn e gửi cho a dạng tài liệu cattalog. @Tiểu Mã Nelia"
//   03:18:29 bot: "Nhân viên muốn tài liệu catalog dạng PDF. Hệ thống em chỉ
//                  tra được nội dung thông số kỹ thuật trong catalog (dạng
//                  văn bản), không ..."
//
// Bot TỪ CHỐI hai lần, trong khi 8 file PDF datasheet ĐANG NẰM SẴN trên server
// (/var/lib/zalo-crm/files/media/*.pdf) và nội dung của chúng đã nạp vào RAG
// (877 chunk, source `datasheet-pdf`). Bot đọc được CHỮ nhưng không gửi được FILE.
//
// Anh Quốc chốt: "nếu như khách yêu cầu gửi pdf thì phải gửi luôn nhé".
import { describe, it, expect, vi } from 'vitest';
import {
  guiTaiLieu, dinhDangGuiTaiLieu, guiTaiLieuDefinition,
  laYeuCauTaiLieu, diemKhopTaiLieu, type TaiLieu,
} from '../../../src/modules/ai/odoo/tools/gui-tai-lieu.js';

/** 8 datasheet THẬT trên prod (query messages 11/08) — dùng nguyên tên file. */
const KHO: TaiLieu[] = [
  { tieuDe: 'LLR - P4 3840-7680HZ.pdf', duongDan: '/media/b5eb.pdf', kichThuoc: 2317395 },
  { tieuDe: 'LLR - P5 Full Outdoor _3840HZ.pdf', duongDan: '/media/8067.pdf', kichThuoc: 207091 },
  { tieuDe: 'LLR -P10 -RGB OPLUNG.pdf', duongDan: '/media/c7fc.pdf', kichThuoc: 2817831 },
  { tieuDe: 'LLR -P10- RGB -4S.pdf', duongDan: '/media/32db.pdf', kichThuoc: 2264097 },
  { tieuDe: 'LLR P3.076-V2.0 OP LUNG.pdf', duongDan: '/media/9a8e.pdf', kichThuoc: 3072344 },
  { tieuDe: 'LLR- P3.076 .3840hz outdoor.pdf', duongDan: 'https://cdn/x1', kichThuoc: 2234045 },
  { tieuDe: 'LLR- P3.076 outdoor dẻo-3840hz.pdf', duongDan: 'https://cdn/x2', kichThuoc: 4209386 },
  { tieuDe: 'P10 SMD ĐỎ LLR ốp lưng.pdf', duongDan: '/media/98de.pdf', kichThuoc: 527649 },
];

const deps = (kho: TaiLieu[] = KHO) => ({
  liet: vi.fn(async () => kho),
  taiVe: vi.fn(async (t: TaiLieu) => `/tmp/${t.tieuDe}`),
});

// ═══════════════════════════════════════════════════════════════════════════
describe('BUG 03:17-03:18 11/08 — bot từ chối trong khi file NẰM SẴN', () => {
  it('câu THẬT của nhân viên "a muốn e gửi cho a dạng tài liệu cattalog" được nhận là XIN TÀI LIỆU', () => {
    expect(laYeuCauTaiLieu('a muốn e gửi cho a dạng tài liệu cattalog')).toBe(true);
  });

  it('xin "catalog" chung chung → LIỆT KÊ cho chọn, KHÔNG gửi bừa cả 8 file', async () => {
    const d = deps();
    const kq = await guiTaiLieu(d, { yeu_cau: 'gửi cho anh tài liệu catalog' });

    expect(kq.loai).toBe('nhieu_ket_qua');
    // TUYỆT ĐỐI không tải/gửi file nào khi chưa biết khách muốn cái nào —
    // dội 8 file PDF (17MB) vào nhóm là spam, Zalo cũng gắn cờ.
    expect(d.taiVe).not.toHaveBeenCalled();
    const s = dinhDangGuiTaiLieu(kq);
    expect(s).toMatch(/chọn|liệt kê|nào/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('KHỚP 1 tài liệu → GỬI THẬT', () => {
  it.each([
    ['cho xin datasheet P4 3840', 'LLR - P4 3840-7680HZ.pdf'],
    ['gửi em file P5 full outdoor', 'LLR - P5 Full Outdoor _3840HZ.pdf'],
    ['gửi tài liệu P10 SMD đỏ ốp lưng', 'P10 SMD ĐỎ LLR ốp lưng.pdf'],
    ['cho xin pdf P3.076 V2.0 op lung', 'LLR P3.076-V2.0 OP LUNG.pdf'],
  ])('"%s" → gửi đúng %s', async (yeuCau, tenMongDoi) => {
    const d = deps();
    const kq = await guiTaiLieu(d, { yeu_cau: yeuCau });

    expect(kq.loai).toBe('da_gui');
    if (kq.loai !== 'da_gui') return;
    expect(kq.taiLieu.tieuDe).toBe(tenMongDoi);
    // Phải TẢI VỀ thật — đường dẫn cục bộ là thứ zaloOps.sendFile cần.
    expect(d.taiVe).toHaveBeenCalledTimes(1);
    expect(kq.duongDanCucBo).toBe(`/tmp/${tenMongDoi}`);
  });

  it('đầu ra nói RÕ đã gửi file nào — model khỏi bịa tên khác', async () => {
    const kq = await guiTaiLieu(deps(), { yeu_cau: 'gửi datasheet P4 3840' });
    const s = dinhDangGuiTaiLieu(kq);
    expect(s).toContain('LLR - P4 3840-7680HZ.pdf');
    expect(s).toMatch(/đã gửi/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('KHÔNG khớp → NÓI THẲNG, không hứa lèo', () => {
  it('xin tài liệu không có trong kho → khong_thay', async () => {
    const d = deps();
    const kq = await guiTaiLieu(d, { yeu_cau: 'gửi catalog đèn năng lượng mặt trời SL500' });

    expect(kq.loai).toBe('khong_thay');
    expect(d.taiVe).not.toHaveBeenCalled();
  });

  it('kho RỖNG → khong_thay, không nổ', async () => {
    const kq = await guiTaiLieu(deps([]), { yeu_cau: 'gửi catalog' });
    expect(kq.loai).toBe('khong_thay');
  });

  it('lời báo KHÔNG được hứa "em gửi sau" — bug 03:18 là bot hứa rồi im', () => {
    const s = dinhDangGuiTaiLieu({ loai: 'khong_thay', yeuCau: 'catalog SL500' });
    expect(s).toMatch(/chưa có/i);
    // Cấm mọi biến thể hứa hẹn: model đọc câu này rồi chép lại cho khách.
    expect(s).not.toMatch(/gửi sau|sẽ gửi|chờ chút|lát nữa/i);
  });

  it('tải file LỖI → báo lỗi thật, KHÔNG báo "đã gửi"', async () => {
    const d = {
      liet: vi.fn(async () => KHO),
      taiVe: vi.fn(async () => { throw new Error('CDN 404'); }),
    };
    const kq = await guiTaiLieu(d, { yeu_cau: 'gửi datasheet P4 3840' });

    expect(kq.loai).toBe('loi');
    expect(dinhDangGuiTaiLieu(kq)).not.toMatch(/đã gửi/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('CHẤM ĐIỂM khớp — mã sản phẩm là thứ phân biệt', () => {
  it('mã model (P4, P10, P3.076) phải kéo điểm lên', () => {
    const p4 = diemKhopTaiLieu('datasheet P4 3840', KHO[0]);
    const p10 = diemKhopTaiLieu('datasheet P4 3840', KHO[2]);
    expect(p4).toBeGreaterThan(p10);
  });

  it('bỏ dấu vẫn khớp — nhân viên hay gõ không dấu', () => {
    expect(diemKhopTaiLieu('gui tai lieu p10 smd do op lung', KHO[7])).toBeGreaterThan(0);
  });

  it('hai file P3.076 chỉ hơn nhau chữ "dẻo" → HỎI, đừng đoán', async () => {
    // Đo thật trên prod 11/08: điểm 5 vs 4, cách nhau 1 < CACH_BIET.
    // "dẻo" (uốn cong được) vs bản cứng là KHÁC HẲN nhau về lắp đặt — đoán sai
    // thì khách đọc xong cả tài liệu mới biết là nhầm. Hỏi một câu rẻ hơn.
    const kq = await guiTaiLieu(deps(), { yeu_cau: 'cho xin pdf P3.076 outdoor dẻo' });
    expect(kq.loai).toBe('nhieu_ket_qua');
    if (kq.loai !== 'nhieu_ket_qua') return;
    expect(kq.ungVien).toHaveLength(2);
    expect(kq.ungVien.every((t) => t.tieuDe.includes('P3.076'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('NHẬN DIỆN yêu cầu tài liệu', () => {
  it.each([
    'gửi catalog',
    'cho xin tài liệu P10',
    'gửi datasheet 3840hz',
    'a muốn e gửi cho a dạng tài liệu cattalog',
    'gửi file pdf cho anh',
    'có catalogue không gửi anh xem',
    'cho xin bản pdf thông số',
  ])('nhận: "%s"', (c) => expect(laYeuCauTaiLieu(c)).toBe(true));

  it.each([
    'đèn này bảo hành mấy năm',
    'giá bao nhiêu',
    'còn hàng không',
    'lên đơn 10 cái',
  ])('KHÔNG nhận nhầm: "%s"', (c) => expect(laYeuCauTaiLieu(c)).toBe(false));
});

// ═══════════════════════════════════════════════════════════════════════════
describe('ĐỊNH NGHĨA tool', () => {
  it('tên + tham số bắt buộc đúng', () => {
    expect(guiTaiLieuDefinition.name).toBe('gui_tai_lieu');
    expect(guiTaiLieuDefinition.inputSchema.required).toEqual(['yeu_cau']);
  });

  it('KHÔNG phải tool GHI — gửi file không đụng Odoo', () => {
    expect(guiTaiLieuDefinition.mutates).not.toBe(true);
  });

  it('mô tả nêu rõ GỬI FILE, phân biệt với tra_tri_thuc (chỉ đọc chữ)', () => {
    expect(guiTaiLieuDefinition.description).toMatch(/tra_tri_thuc/);
    expect(guiTaiLieuDefinition.description).toMatch(/FILE|PDF/);
  });
});

describe('CA 17:14-17:18 13/08 — nêu đích danh tên file phải GỬI, không hỏi vòng vô hạn', () => {
  // NV chọn "2" trong danh sách, model gọi lại với đúng tên file — mà chấm
  // điểm ra 6 vs 5 (hai tên chỉ khác MỘT token) < CACH_BIET nên tool cứ trả
  // danh sách mãi, bot bó tay xin lỗi giữa nhóm.
  it('nguyên văn "LLR -P10 -RGB OPLUNG.pdf" → gửi ngay, không đòi cách biệt điểm', async () => {
    const d = deps();
    const kq = await guiTaiLieu(d, { yeu_cau: 'LLR -P10 -RGB OPLUNG.pdf' });
    expect(kq.loai).toBe('da_gui');
    if (kq.loai === 'da_gui') expect(kq.taiLieu.tieuDe).toBe('LLR -P10 -RGB OPLUNG.pdf');
  });

  it('tên nằm trong câu, "ốp lưng" rời vẫn khớp "OPLUNG" dính liền', async () => {
    const kq = await guiTaiLieu(deps(), { yeu_cau: 'gửi file llr p10 rgb ốp lưng cho anh' });
    expect(kq.loai).toBe('da_gui');
    if (kq.loai === 'da_gui') expect(kq.taiLieu.tieuDe).toBe('LLR -P10 -RGB OPLUNG.pdf');
  });

  it('file "họ hàng" một-token-khác: nêu đích danh 4S thì ra đúng 4S', async () => {
    const kq = await guiTaiLieu(deps(), { yeu_cau: 'LLR -P10- RGB -4S.pdf' });
    expect(kq.loai).toBe('da_gui');
    if (kq.loai === 'da_gui') expect(kq.taiLieu.tieuDe).toBe('LLR -P10- RGB -4S.pdf');
  });

  it('câu mơ hồ "gửi cattalog p10 full outdoor" vẫn HỎI như cũ (một lần, có danh sách)', async () => {
    const kq = await guiTaiLieu(deps(), { yeu_cau: 'gửi cattalog p10 full outdoor' });
    expect(kq.loai).toBe('nhieu_ket_qua');
  });
});
