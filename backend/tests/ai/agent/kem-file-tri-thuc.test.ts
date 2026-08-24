// SPDX-License-Identifier: AGPL-3.0-or-later
// Ca thật 17:13 24/08: NV "@bot cho tôi thông số kỹ thuật đầu xử lý ovp-k10p"
// → bot trả LỜI đúng từ RAG nhưng KHÔNG gửi kèm file K10P.pdf đang nằm sẵn
// trong kho — anh Quốc: "tại sao không gửi file cho khách luôn???".
// tra_tri_thuc giờ tự đính file khi (a) câu hỏi dạng thông số/datasheet và
// (b) khớp DUY NHẤT một file trong kho.
import { describe, it, expect } from 'vitest';
import {
  laCauHoiThongSo, kemFileTriThuc, type TaiLieu,
} from '../../../src/modules/ai/odoo/tools/gui-tai-lieu.js';

const KHO: TaiLieu[] = [
  { tieuDe: 'K10P.pdf', duongDan: 'http://x/k10p.pdf', kichThuoc: 100 },
  { tieuDe: 'K10.pdf', duongDan: 'http://x/k10.pdf', kichThuoc: 100 },
  { tieuDe: 'Bóng LED F8 Full IC 1908.pdf', duongDan: 'http://x/f8-1908.pdf', kichThuoc: 100 },
  { tieuDe: 'Bóng LED F8 Full IC8028.pdf', duongDan: 'http://x/f8-8028.pdf', kichThuoc: 100 },
  { tieuDe: 'Y2.pdf', duongDan: 'http://x/y2.pdf', kichThuoc: 100 },
];
const deps = {
  liet: async () => KHO,
  taiVe: async (t: TaiLieu) => `/tmp/${t.tieuDe}`,
};

describe('laCauHoiThongSo', () => {
  it('câu xin thông số/datasheet → true', () => {
    expect(laCauHoiThongSo('cho tôi thông số kỹ thuật đầu xử lý ovp-k10p')).toBe(true);
    expect(laCauHoiThongSo('thong so ky thuat nguon 12v100w m7')).toBe(true);
    expect(laCauHoiThongSo('datasheet card K4')).toBe(true);
  });
  it('câu hỏi vụn (IP mấy, bảo hành) → false, khỏi spam file', () => {
    expect(laCauHoiThongSo('đèn này IP bao nhiêu')).toBe(false);
    expect(laCauHoiThongSo('bảo hành mấy năm')).toBe(false);
    expect(laCauHoiThongSo('lắp thế nào')).toBe(false);
  });
});

describe('kemFileTriThuc — khớp file theo câu hỏi + tiêu đề đoạn RAG', () => {
  it('ca thật K10P: mã trần trong câu → đúng K10P.pdf, KHÔNG dính K10.pdf', async () => {
    const kq = await kemFileTriThuc(
      deps,
      'cho tôi thông số kỹ thuật đầu xử lý ovp-k10p',
      'THÔNG SỐ KỸ THUẬT BỘ XỬ LÝ HÌNH ẢNH OVP-K10P',
    );
    expect(kq?.tieuDe).toBe('K10P.pdf');
  });

  it('tên file nhiều chữ: khớp qua chấm điểm token', async () => {
    const kq = await kemFileTriThuc(
      deps,
      'thông số bóng led f8 full ic 1908',
      'Bóng LED F8 Full IC 1908',
    );
    expect(kq?.tieuDe).toBe('Bóng LED F8 Full IC 1908.pdf');
  });

  it('không phải câu thông số → null (không gửi)', async () => {
    expect(await kemFileTriThuc(deps, 'đèn này IP bao nhiêu', 'K10P abc')).toBeNull();
  });

  it('mơ hồ (không nêu mã nào) → null, thà không gửi còn hơn gửi bừa', async () => {
    expect(await kemFileTriThuc(deps, 'cho tôi thông số kỹ thuật', 'Thông Số Kỹ Thuật')).toBeNull();
  });
});
