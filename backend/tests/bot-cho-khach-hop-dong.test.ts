// SPDX-License-Identifier: AGPL-3.0-or-later
// Hợp đồng "Cho khách" (docs/79 T5) — hàm THUẦN: chuẩn hoá + băm mô tả, kiểm danh mục bot đẩy lên, dựng payload duyệt.
// Hợp đồng: docs/may-in/HOP-DONG-CHO-KHACH.md. Vector băm ở đây phải TRÙNG vector trong hợp đồng (bot kiểm cùng vector).
import { describe, it, expect } from 'vitest';
import {
  chuanMoTa, bamMoTa, bamNoiDungTaiLieu, docDanhMuc, dungDuyetCongKhai, LoiChoKhach, CAT_MAU_NOI_DUNG,
} from '../src/modules/bot-quyen/bot-cho-khach-hop-dong.js';

const BAM_RONG = /^[0-9a-f]{64}$/;

function sp(them: Record<string, unknown> = {}) {
  const mo = 'Điện áp 12V\nIP65';
  return { product_id: 11, ma: 'LED-01', ten: 'Led dây 12V', mo_ta_ban: mo, mo_ta_bam: bamMoTa(mo), ...them };
}
function tl(them: Record<string, unknown> = {}) {
  return {
    id: '0b6a3c1e-1111-4a4a-9c9c-000000000001', tieu_de: 'Datasheet P10', loai: 'pdf', nguon: 'file-zalo', so_doan: 12,
    cap_nhat_luc: '2026-09-30T02:00:00.000Z', mau_noi_dung: 'Module P10 full color…', noi_dung_bam: 'd'.repeat(64), ...them,
  };
}
function loi(f: () => unknown): LoiChoKhach {
  try { f(); } catch (e) { if (e instanceof LoiChoKhach) return e; throw e; }
  throw new Error('không ném lỗi');
}

describe('chuanMoTa / bamMoTa — chuẩn hoá trước khi băm (K2)', () => {
  it('gộp khoảng trắng, bỏ dòng trống, CRLF = LF, NBSP = cách, NFC', () => {
    expect(chuanMoTa('  Điện   áp\t12V \r\n\r\n\u00a0IP65  \n')).toBe('Điện áp 12V\nIP65');
    // NFD (dấu tách) ⇒ NFC
    expect(chuanMoTa('Điện')).toBe('Điện');
  });
  it('lớp khoảng trắng TƯỜNG MINH (hợp đồng §3): em-space, BOM gộp; \\x1c (Python \\s có, hợp đồng không) GIỮ', () => {
    expect(chuanMoTa('a\u2003\ufeff b')).toBe('a b');
    expect(chuanMoTa('a\x1cb')).toBe('a\x1cb');
    // Vector đối chiếu với bản Python trong hợp đồng.
    expect(bamMoTa('\ufeffĐiện\u3000áp 12V\u2028\nIP65')).toBe(VECTOR);
  });
  it('khác biệt chỉ ở khoảng trắng ⇒ cùng băm; khác một ký tự ⇒ khác băm', () => {
    expect(bamMoTa('Điện áp 12V\nIP65')).toBe(bamMoTa(' Điện  áp 12V \r\n\r\nIP65 '));
    expect(bamMoTa('Điện áp 12V\nIP65')).not.toBe(bamMoTa('Điện áp 24V\nIP65'));
  });
  it('rỗng sau chuẩn hoá ⇒ null (SP không có mô tả)', () => {
    expect(bamMoTa('  \n\t ')).toBeNull();
    expect(bamMoTa(null)).toBeNull();
    expect(bamMoTa('a')).toMatch(BAM_RONG);
  });
  it('vector cố định: "Điện áp 12V\\nIP65"', () => {
    expect(bamMoTa('Điện áp 12V\nIP65')).toBe(VECTOR);
  });
});

describe('bamNoiDungTaiLieu — băm nội dung tài liệu (duyệt tài liệu gắn NỘI DUNG, hợp đồng §3b)', () => {
  it('nối kb_chunks.noi_dung theo ord bằng "\\n" rồi chuẩn hoá + sha256 như mô tả', () => {
    expect(bamNoiDungTaiLieu(['Điện áp 12V', 'IP65'])).toBe(VECTOR);
    expect(bamNoiDungTaiLieu([' Điện  áp 12V \r\n', '', '\u00a0IP65 '])).toBe(VECTOR);
  });
  it('thứ tự đoạn khác ⇒ băm khác; không có đoạn / toàn khoảng trắng ⇒ null', () => {
    expect(bamNoiDungTaiLieu(['IP65', 'Điện áp 12V'])).not.toBe(VECTOR);
    expect(bamNoiDungTaiLieu([])).toBeNull();
    expect(bamNoiDungTaiLieu(['  ', '\t'])).toBeNull();
  });
  it('vector hai đoạn cố định (in trong hợp đồng §3b)', () => {
    expect(bamNoiDungTaiLieu(['Module P10 full color', 'Điện áp 5V\nCông suất 30W'])).toBe(VECTOR_TL);
  });
});

// Giá trị tính một lần bằng sha256(utf8("Điện áp 12V\nIP65")) — in nguyên văn trong HOP-DONG-CHO-KHACH.md §3.
const VECTOR = 'cff3e472b1116ef9867dc369dad46aa544120d98453a1caa159daef1b39442a9';
// sha256(utf8("Module P10 full color\nĐiện áp 5V\nCông suất 30W")) — in nguyên văn trong hợp đồng §3b.
const VECTOR_TL = '954417e52b60aaf91952023735fbdc9c657abde3387872de1d285fc05ba34c45';

describe('docDanhMuc — kiểm danh mục bot đẩy lên', () => {
  it('hợp lệ ⇒ chuẩn hoá: trường lạ bỏ, mẫu nội dung cắt 300 ký tự, null cho ô vắng', () => {
    const dai = 'x'.repeat(1000);
    const d = docDanhMuc({
      phien_ban: 'v1', la: 1,
      tai_lieu: [tl({ mau_noi_dung: dai, them: 'bỏ' }), tl({ id: 'doc-2', loai: undefined, nguon: null, mau_noi_dung: undefined, cap_nhat_luc: null })],
      san_pham: [sp(), sp({ product_id: 12, ma: null, mo_ta_ban: null, mo_ta_bam: null })],
    });
    expect(d.phien_ban).toBe('v1');
    expect(d.tai_lieu[0].mau_noi_dung).toHaveLength(CAT_MAU_NOI_DUNG);
    expect(d.tai_lieu[0]).not.toHaveProperty('them');
    expect(d.tai_lieu[1]).toEqual({
      id: 'doc-2', tieu_de: 'Datasheet P10', loai: null, nguon: null, so_doan: 12, cap_nhat_luc: null, mau_noi_dung: null,
      noi_dung_bam: 'd'.repeat(64),
    });
    expect(d.san_pham[1]).toEqual({ product_id: 12, ma: null, ten: 'Led dây 12V', mo_ta_ban: null, mo_ta_bam: null });
  });
  it('mo_ta_bam phải KHỚP băm CRM tự tính (cùng cách chuẩn hoá) ⇒ lệch = 400 MO_TA_BAM_LECH', () => {
    const e = loi(() => docDanhMuc({ phien_ban: 'v', tai_lieu: [], san_pham: [sp({ mo_ta_bam: 'a'.repeat(64) })] }));
    expect([e.status, e.code]).toEqual([400, 'MO_TA_BAM_LECH']);
  });
  it('noi_dung_bam BẮT BUỘC có mặt: null (tài liệu rỗng) được, vắng / sai dạng ⇒ 400', () => {
    expect(docDanhMuc({ phien_ban: 'v', tai_lieu: [tl({ noi_dung_bam: null })], san_pham: [] }).tai_lieu[0].noi_dung_bam).toBeNull();
    const vang = tl();
    delete (vang as Record<string, unknown>).noi_dung_bam;
    expect(loi(() => docDanhMuc({ phien_ban: 'v', tai_lieu: [vang], san_pham: [] })).code).toBe('DANH_MUC_KHONG_HOP_LE');
    expect(loi(() => docDanhMuc({ phien_ban: 'v', tai_lieu: [tl({ noi_dung_bam: 'D'.repeat(64) })], san_pham: [] })).code)
      .toBe('DANH_MUC_KHONG_HOP_LE');
    expect(loi(() => docDanhMuc({ phien_ban: 'v', tai_lieu: [tl({ noi_dung_bam: 'abc' })], san_pham: [] })).code)
      .toBe('DANH_MUC_KHONG_HOP_LE');
  });
  it('có mô tả mà thiếu băm / không có mô tả mà có băm ⇒ 400', () => {
    expect(loi(() => docDanhMuc({ phien_ban: 'v', tai_lieu: [], san_pham: [sp({ mo_ta_bam: null })] })).code).toBe('MO_TA_BAM_LECH');
    expect(loi(() => docDanhMuc({ phien_ban: 'v', tai_lieu: [], san_pham: [sp({ mo_ta_ban: '  ', mo_ta_bam: 'a'.repeat(64) })] })).code)
      .toBe('MO_TA_BAM_LECH');
  });
  it.each([
    ['thiếu phien_ban', { tai_lieu: [], san_pham: [] }],
    ['phien_ban rỗng', { phien_ban: '', tai_lieu: [], san_pham: [] }],
    ['tai_lieu không phải mảng', { phien_ban: 'v', tai_lieu: {}, san_pham: [] }],
    ['id tài liệu sai dạng', { phien_ban: 'v', tai_lieu: [tl({ id: 'có dấu cách' })], san_pham: [] }],
    ['id tài liệu trùng', { phien_ban: 'v', tai_lieu: [tl(), tl()], san_pham: [] }],
    ['tiêu đề rỗng', { phien_ban: 'v', tai_lieu: [tl({ tieu_de: '  ' })], san_pham: [] }],
    ['so_doan âm', { phien_ban: 'v', tai_lieu: [tl({ so_doan: -1 })], san_pham: [] }],
    ['cap_nhat_luc không phải ngày', { phien_ban: 'v', tai_lieu: [tl({ cap_nhat_luc: 'hôm qua' })], san_pham: [] }],
    ['product_id không nguyên dương', { phien_ban: 'v', tai_lieu: [], san_pham: [sp({ product_id: 0 })] }],
    ['product_id trùng', { phien_ban: 'v', tai_lieu: [], san_pham: [sp(), sp()] }],
    ['tên SP rỗng', { phien_ban: 'v', tai_lieu: [], san_pham: [sp({ ten: '' })] }],
    ['body không phải object', 'chuỗi'],
  ])('%s ⇒ 400 DANH_MUC_KHONG_HOP_LE', (_t, body) => {
    const e = loi(() => docDanhMuc(body));
    expect([e.status, e.code]).toEqual([400, 'DANH_MUC_KHONG_HOP_LE']);
  });
});

describe('dungDuyetCongKhai — payload GET /api/public/cho-khach/duyet', () => {
  it('sắp xếp tất định; phien_ban = sha256 hex của JSON chuẩn; đổi một băm ⇒ phien_ban đổi', () => {
    const a = dungDuyetCongKhai([{ taiLieuId: 'b', noiDungBam: 'b'.repeat(64) }, { taiLieuId: 'a', noiDungBam: 'a'.repeat(64) }], [{ productId: 12, moTaBam: 'f'.repeat(64) }, { productId: 3, moTaBam: 'e'.repeat(64) }], 'dm1');
    expect(a.tai_lieu_cho_khach).toEqual([{ id: 'a', noi_dung_bam: 'a'.repeat(64) }, { id: 'b', noi_dung_bam: 'b'.repeat(64) }]);
    expect(a.mo_ta_da_duyet.map((m) => m.product_id)).toEqual([3, 12]);
    expect(a.phien_ban).toMatch(BAM_RONG);
    expect(a.danh_muc_phien_ban).toBe('dm1');
    const tlAB = [{ taiLieuId: 'a', noiDungBam: 'a'.repeat(64) }, { taiLieuId: 'b', noiDungBam: 'b'.repeat(64) }];
    const b = dungDuyetCongKhai(tlAB, [{ productId: 3, moTaBam: 'e'.repeat(64) }, { productId: 12, moTaBam: 'f'.repeat(64) }], 'dm1');
    expect(b.phien_ban).toBe(a.phien_ban);
    const c = dungDuyetCongKhai(tlAB, [{ productId: 3, moTaBam: 'e'.repeat(64) }, { productId: 12, moTaBam: 'd'.repeat(64) }], 'dm1');
    expect(c.phien_ban).not.toBe(a.phien_ban);
    // Băm nội dung tài liệu đổi ⇒ phien_ban đổi (bot biết phải áp lại).
    const d = dungDuyetCongKhai([tlAB[0], { taiLieuId: 'b', noiDungBam: 'c'.repeat(64) }], b.mo_ta_da_duyet.map((m) => ({ productId: m.product_id, moTaBam: m.mo_ta_bam })), 'dm1');
    expect(d.phien_ban).not.toBe(b.phien_ban);
  });
});
