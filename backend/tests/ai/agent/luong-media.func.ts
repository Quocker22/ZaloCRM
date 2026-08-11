// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: tin không phải chữ — sticker bỏ qua, ảnh/voice báo người.
//
// Lỗ hổng gốc (06/08/2026): hai luồng agent chỉ nhận contentType='text', mọi
// sticker/ảnh/voice rơi vào im lặng TUYỆT ĐỐI. Ảnh khách gửi thường là ảnh
// CHUYỂN KHOẢN — im lặng ở đó là mất tiền thật.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/modules/ai/agent/noi-zalo/gui-zalo.js', () => ({
  timDich: vi.fn(async () => ({
    accountId: 'acc-1', threadId: 'kh-1', threadType: 0,
    zaloUid: 'kh-uid', tenKhach: 'Anh Long', sdtKhach: null,
  })),
  guiTin: vi.fn(async () => {}),
}));

import { timDich, guiTin } from '../../../src/modules/ai/agent/noi-zalo/gui-zalo.js';
import {xuLyTinMedia} from '../../../src/modules/ai/agent/noi-zalo/luong-media.js';
import { chiCoEmoji } from '../../../src/modules/ai/agent/noi-zalo/chi-co-emoji.js';
import { xoaLichSuBao } from '../../../src/modules/ai/agent/noi-zalo/bao-nhan-vien.js';
import { logger } from '../../../src/shared/utils/logger.js';

const CTX = { orgId: 'org-1', conversationId: 'conv-media', messageId: 'msg-1' };

let goc: NodeJS.ProcessEnv;
beforeEach(() => {
  goc = { ...process.env };
  process.env.AI_AGENT_KHACH = '1';
  process.env.AI_AGENT_THREAD_BAO_SALE = 'nhom-sale';
  xoaLichSuBao();
  vi.mocked(guiTin).mockClear();
  vi.mocked(timDich).mockClear();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  process.env = goc;
  vi.restoreAllMocks();
});

describe('chiCoEmoji — cái like không đáng một lượt agent', () => {
  it.each(['👍', '👌👌', '😀 !!', '???', '...', '   ', ''])(
    'chỉ emoji/trang trí: "%s" → true', (t) => expect(chiCoEmoji(t)).toBe(true),
  );

  it.each(['ok 👍', '10 cái', 'ừ', 'giá nhiêu 😀', '5'])(
    'có nội dung thật: "%s" → false', (t) => expect(chiCoEmoji(t)).toBe(false),
  );
});

describe('xuLyTinMedia — ảnh/voice: giữ chân + báo người', () => {
  it('ảnh từ khách 1-1 → MỘT câu giữ chân + MỘT tin báo nhân viên', async () => {
    const kq = await xuLyTinMedia(CTX, 'image');

    expect(kq).toBe(true);
    // 2 lần guiTin: 1 báo nhân viên (qua baoNhanVien), 1 giữ chân khách.
    expect(guiTin).toHaveBeenCalledTimes(2);
    const noiDungGuiKhach = vi.mocked(guiTin).mock.calls
      .map((c) => c[1])
      .find((t) => t.includes('em đã nhận được'));
    expect(noiDungGuiKhach).toContain('ảnh');
  });

  it('album 5 tấm → vẫn chỉ MỘT lượt giữ chân + báo (throttle của bao-nhan-vien)', async () => {
    for (let i = 0; i < 5; i++) await xuLyTinMedia(CTX, 'image');

    expect(guiTin).toHaveBeenCalledTimes(2); // không phải 10
  });

  it('sticker → bỏ qua có chủ đích: không gửi gì, nhưng trả true (đã xử lý)', async () => {
    const kq = await xuLyTinMedia(CTX, 'sticker');

    expect(kq).toBe(true);
    expect(guiTin).not.toHaveBeenCalled();
  });

  it('trong NHÓM → không làm gì: giữ chân giữa đám đông là ồn vô nghĩa', async () => {
    const kq = await xuLyTinMedia({ ...CTX, laNhom: true }, 'image');

    expect(kq).toBe(false);
    expect(guiTin).not.toHaveBeenCalled();
  });

  it('công tắc AI_AGENT_KHACH tắt → không làm gì (mặc định an toàn)', async () => {
    process.env.AI_AGENT_KHACH = '0';

    expect(await xuLyTinMedia(CTX, 'image')).toBe(false);
    expect(guiTin).not.toHaveBeenCalled();
  });

  it('voice → câu giữ chân nói đúng loại ("tin nhắn thoại", không phải "ảnh")', async () => {
    await xuLyTinMedia(CTX, 'voice');

    const guiKhach = vi.mocked(guiTin).mock.calls.map((c) => c[1]).find((t) => t.includes('em đã nhận được'));
    expect(guiKhach).toContain('tin nhắn thoại');
  });

  it('loại lạ (vd "location") → trả false, để pipeline cũ tự xử', async () => {
    expect(await xuLyTinMedia(CTX, 'location')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LINK (11/08) — anh Quốc soi sơ đồ luồng và bắt được: 'link' bị gom chung
// nhóm bỏ qua với sticker/gif. Lý do gom ("người thật cũng không đáp sticker")
// ĐÚNG với sticker nhưng SAI với link: sticker KHÔNG mang thông tin, còn link
// thì CÓ. Ca thật đo trên prod 60 ngày: khách gửi đúng 1 link — một Google
// Sheet tên "Thông số sản phẩm LED NELIA", nhiều khả năng là bảng hàng cần
// báo giá. Bot im hoàn toàn, khách tưởng đã nhận.
describe('link — KHÔNG được im lặng (bug 11/08)', () => {
  // Nguyên văn content của tin thật trên prod (rút gọn thumb cho gọn).
  // Chú ý shape: `title` = chính URL do Zalo tự bung thẻ, còn TÊN người gõ/đặt
  // nằm trong params.mediaTitle. Đây là lý do phải bóc params, không dùng title.
  const LINK_SHEET = JSON.stringify({
    title: 'https://docs.google.com/spreadsheets/d/1RygKKQMBOGkvYOjbfRA5YYTbJrE-_hKkF59EOu9eBO8/edit?gid=0#gid=0',
    description: '',
    href: 'https://docs.google.com/spreadsheets/d/1RygKKQMBOGkvYOjbfRA5YYTbJrE-_hKkF59EOu9eBO8/edit?gid=0#gid=0',
    thumb: 'https://photo-stal-3.zdn.vn/gr/abc.jpg',
    action: 'recommened.link',
    params: JSON.stringify({ src: 'docs.google.com', mediaTitle: 'Thông số sản phẩm LED NELIA' }),
  });

  it('CA THẬT: khách gửi Google Sheet → giữ chân khách + báo nhân viên, KHÔNG im lặng', async () => {
    const kq = await xuLyTinMedia({ ...CTX, content: LINK_SHEET }, 'link');

    expect(kq).toBe(true);
    expect(guiTin).toHaveBeenCalled();
    const guiKhach = vi.mocked(guiTin).mock.calls.map((c) => c[1]).find((t) => t.includes('em đã nhận được'));
    expect(guiKhach).toContain('đường link');
  });

  it('tin báo nhân viên nêu RÕ tên trang + tên tài liệu để người biết mở cái gì', async () => {
    await xuLyTinMedia({ ...CTX, content: LINK_SHEET }, 'link');

    const baoNv = vi.mocked(guiTin).mock.calls.map((c) => c[1]).find((t) => t.includes('docs.google.com'));
    expect(baoNv).toBeTruthy();
    expect(baoNv).toContain('Thông số sản phẩm LED NELIA');
  });

  it('BẢO MẬT: bot KHÔNG tự đi tải nội dung link (chặn SSRF + prompt injection)', async () => {
    // Khách gửi link trỏ vào MẠNG NỘI BỘ để dò hệ thống. Bot chỉ được nhắc
    // lại URL cho người thật, tuyệt đối không fetch. Nếu ai đó sau này thêm
    // fetch vào đây, test này phải đỏ.
    const fetchGiaLap = vi.spyOn(globalThis, 'fetch');
    const LINK_NOI_BO = JSON.stringify({
      title: 'http://100.107.48.28:5432/', href: 'http://100.107.48.28:5432/',
      action: 'recommened.link', params: '{"src":"100.107.48.28"}',
    });

    const kq = await xuLyTinMedia({ ...CTX, content: LINK_NOI_BO }, 'link');

    expect(kq).toBe(true);
    expect(fetchGiaLap).not.toHaveBeenCalled();
  });

  it('link do BOT tự gửi (isSelf) → không tự xử lý, tránh bot nói với chính mình', async () => {
    // Prod 60 ngày: 1/2 tin link là của nick shop (link mời vào nhóm). Bot mà
    // giữ chân chính nó thì thành vòng lặp.
    const kq = await xuLyTinMedia({ ...CTX, content: LINK_SHEET, isSelf: true }, 'link');

    expect(kq).toBe(false);
    expect(guiTin).not.toHaveBeenCalled();
  });

  it('link trong NHÓM → không giữ chân (ồn), như voice/file', async () => {
    const kq = await xuLyTinMedia({ ...CTX, content: LINK_SHEET, laNhom: true }, 'link');

    expect(kq).toBe(false);
    expect(guiTin).not.toHaveBeenCalled();
  });

  it('link nhiều lần → throttle: vẫn chỉ MỘT lượt giữ chân + báo', async () => {
    for (let i = 0; i < 4; i++) await xuLyTinMedia({ ...CTX, content: LINK_SHEET }, 'link');

    expect(guiTin).toHaveBeenCalledTimes(2);
  });

  it('sticker/gif VẪN bỏ qua — đừng phá cái đang đúng', async () => {
    expect(await xuLyTinMedia({ ...CTX, content: LINK_SHEET }, 'sticker')).toBe(true);
    expect(await xuLyTinMedia({ ...CTX, content: LINK_SHEET }, 'gif')).toBe(true);
    expect(guiTin).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ĐỌC ẢNH (10/08) — anh Quốc: "làm bot đọc được ảnh… chỉ đọc ảnh rồi lấy
// thông tin xử lý thôi". Ảnh → chữ → luồng thường, nên mọi nghiệp vụ sẵn có
// (gom đơn, tra khách, tool Odoo) dùng được với ảnh mà không viết lại đường nào.
//
// Ranh giới quan trọng: đọc HỎNG thì phải rơi xuống đường báo người, TUYỆT ĐỐI
// không im lặng — im lặng với ảnh chuyển khoản là mất tiền thật.
describe('đọc ảnh — chuyển thành chữ rồi đưa vào luồng thường', () => {
  const ANH = JSON.stringify({
    title: 'lên đơn cái này cho anh Thức',
    href: 'http://media/abc.jpg',
    thumb: 'http://media/abc-thumb.jpg',
  });

  it('không có content → không có URL → vẫn báo người như cũ (không im lặng)', async () => {
    const kq = await xuLyTinMedia(CTX, 'image');
    expect(kq).toBe(true);
    expect(guiTin).toHaveBeenCalled();
  });

  it('content JSON hỏng → báo người, KHÔNG ném lỗi', async () => {
    const kq = await xuLyTinMedia({ ...CTX, content: '{hỏng' }, 'image');
    expect(kq).toBe(true);
    expect(guiTin).toHaveBeenCalled();
  });

  it('sticker vẫn bỏ qua — không tốn tiền đọc ảnh cho cái nhãn dán', async () => {
    const kq = await xuLyTinMedia({ ...CTX, content: ANH }, 'sticker');
    expect(kq).toBe(true);
    expect(guiTin).not.toHaveBeenCalled();
  });

  it('voice/video vẫn đi đường báo người — chưa đọc được', async () => {
    await xuLyTinMedia({ ...CTX, content: ANH }, 'voice');
    expect(guiTin).toHaveBeenCalled();
  });

  it('ẢNH TRONG NHÓM: đọc (anh Quốc chốt "mọi ảnh trong nhóm đều đọc")', async () => {
    // Trước 10/08 nhóm bị chặn ngay dòng đầu. Giờ ảnh phải đi tiếp vào nhánh
    // đọc; đọc hỏng (không mock model) thì KHÔNG báo người trong nhóm — giữ
    // chân giữa nhóm đông người vừa ồn vừa vô nghĩa.
    const kq = await xuLyTinMedia({ ...CTX, content: ANH, laNhom: true }, 'image');
    expect(kq).toBe(false);
    expect(guiTin).not.toHaveBeenCalled();
  });

  it('voice trong NHÓM vẫn không giữ chân', async () => {
    const kq = await xuLyTinMedia({ ...CTX, laNhom: true }, 'voice');
    expect(kq).toBe(false);
    expect(guiTin).not.toHaveBeenCalled();
  });
});
