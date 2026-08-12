// SPDX-License-Identifier: AGPL-3.0-or-later
// REPLAY CA THẬT — LƯỢT ĐẦU của phiếu nhập, 16:53:09 ngày 12/08/2026.
//
//   16:53:09  NV : [Ảnh danh sách hàng] "@Tiểu Mã Nelia tạo phiếu nhập hàng
//                   giúp tôi nhà cung cấp là Trung Quốc"
//   16:53:38  Bot: 'Có 2 nhà cung cấp tên "Trung Quốc": 1)… 2)… chọn giúp em'
//   16:53:44  NV : "1"
//   16:53:44  Bot: 'Anh/chị nhập những hàng gì ạ?'   ← HỎI THỨ ĐÃ CÓ TRONG ẢNH
//   Anh Quốc: "ủa là sao nữa, các sản phẩm tôi đã gửi trong ảnh rồi".
//
// KHÁC GỐC với `replay-anh-phieu-nhap-12-08.test.ts`: ca đó ảnh tới ở lượt 3
// (sau khi NCC đã chốt), và cả 3 lỗi A/B/C đều nằm ở đường xử lượt sau. Ca này
// ảnh đi KÈM NGAY LƯỢT ĐẦU — cùng MỘT tin Zalo, chú thích nằm trong
// `content.title`. Đây là đường đi khác hẳn, chưa test nào phủ.
//
// Test này đo ĐÚNG một câu hỏi: khi ảnh + lời nhắn về cùng một tin, chú thích
// "tạo phiếu nhập hàng… nhà cung cấp là Trung Quốc" và danh sách hàng trong ảnh
// có CÙNG tới máy gom đơn trong MỘT câu hay không.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/modules/ai/agent/noi-zalo/gui-zalo.js', () => ({
  timDich: vi.fn(async () => ({
    accountId: 'acc-1', threadId: 'nhom-1', threadType: 1,
    zaloUid: 'kh-uid', tenKhach: 'Nhóm Test', sdtKhach: null,
  })),
  guiTin: vi.fn(async () => {}),
}));

// Chặn đúng hai luồng nhận chữ để SOI câu mà `docVaChuyenTiep` ném sang.
vi.mock('../../../src/modules/ai/agent/noi-zalo/luong-nhan-vien.js', () => ({
  xuLyTinNhanVien: vi.fn(async () => true),
  laLenhNhanVien: vi.fn(() => true),
  dangChoTraLoiNv: vi.fn(async () => false),
}));
vi.mock('../../../src/modules/ai/agent/noi-zalo/luong-khach.js', () => ({
  xuLyTinKhach: vi.fn(async () => false),
}));

// Model nhìn ảnh: trả đúng danh sách hàng viết tay trong ảnh thật.
vi.mock('../../../src/modules/ai/providers/openai-compat.js', () => ({
  nhinAnhOpenaiCompat: vi.fn(async () => NOI_DUNG_ANH),
}));
vi.mock('../../../src/modules/ai/agent/noi-zalo/llm.js', () => ({
  layCauHinhLlm: vi.fn(async () => ({ url: 'https://x', apiKey: 'k', model: 'm' })),
}));

import { xuLyTinMedia } from '../../../src/modules/ai/agent/noi-zalo/luong-media.js';
import { xuLyTinNhanVien } from '../../../src/modules/ai/agent/noi-zalo/luong-nhan-vien.js';
import { logger } from '../../../src/shared/utils/logger.js';

/** Nội dung ảnh thật — giấy viết tay, rút gọn còn các dòng đầu. */
const NOI_DUNG_ANH = [
  'P10 full out: 10.000 tấm | 242 thùng',
  'P5 full out: 1460 tấm',
  'Cabin 960*960*120: 80 cái',
].join('\n');

/**
 * Tin Zalo THẬT lúc 16:53:09 — ảnh và chú thích trong CÙNG một tin.
 * `title` là câu nhân viên gõ kèm ảnh (đo shape zca-js, xem doc-anh.ts).
 */
const CHU_THICH = '@Tiểu Mã Nelia tạo phiếu nhập hàng giúp tôi nhà cung cấp là Trung Quốc';
const ANH_KEM_CHU = JSON.stringify({
  title: CHU_THICH,
  href: 'https://f1.zdn.vn/anh-phieu-nhap.jpg',
  thumb: 'https://f1.zdn.vn/thumb.jpg',
});

const CTX = {
  orgId: 'org-1',
  conversationId: 'conv-nhom',
  messageId: 'msg-1653',
  laNhom: true,
  daTagBot: true,
  senderUid: 'uid-quoc',
  isSelf: false,
};

let goc: NodeJS.ProcessEnv;
beforeEach(() => {
  goc = { ...process.env };
  // Công tắc luồng khách — `xuLyTinMedia` thoát ngay ở dòng đầu nếu thiếu.
  process.env.AI_AGENT_KHACH = '1';
  vi.mocked(xuLyTinNhanVien).mockClear();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  // fetch ảnh — trả một buffer nhỏ, không gọi mạng thật.
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    headers: { get: () => 'image/jpeg' },
    arrayBuffer: async () => new ArrayBuffer(64),
  })));
});
afterEach(() => {
  process.env = goc;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ca thật 16:53 12/08 — ảnh + lời nhắn TRONG CÙNG MỘT TIN (lượt đầu)', () => {
  it('câu ném sang luồng nhân viên phải có CẢ ý định LẪN danh sách hàng', async () => {
    await xuLyTinMedia({ ...CTX, content: ANH_KEM_CHU }, 'photo');

    expect(xuLyTinNhanVien).toHaveBeenCalledTimes(1);
    const cau = String(vi.mocked(xuLyTinNhanVien).mock.calls[0][0].content);

    // Ý định + tên NCC (từ chú thích) phải còn.
    expect(cau).toContain('tạo phiếu nhập hàng');
    expect(cau).toContain('Trung Quốc');
    // Danh sách hàng (từ ảnh) phải có mặt trong CÙNG câu đó.
    expect(cau).toContain('P10 full out');
    expect(cau).toContain('P5 full out');
  });

  it('cờ daTagBot phải đi kèm sang luồng nhân viên — nhóm mà mất tag là câu bị vứt', async () => {
    await xuLyTinMedia({ ...CTX, content: ANH_KEM_CHU }, 'photo');

    const ctxChu = vi.mocked(xuLyTinNhanVien).mock.calls[0][0];
    expect(ctxChu.laNhom).toBe(true);
    // Trong nhóm, `nhanDienLenhNhanVien` bắt buộc có tag. Mất cờ này thì lệnh
    // rớt ở cổng và cả lượt im lặng.
    expect(ctxChu.daTagBot).toBe(true);
  });
});
