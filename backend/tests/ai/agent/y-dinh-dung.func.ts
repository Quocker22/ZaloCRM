// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: người dùng bảo DỪNG thì bot không được ghi thêm gì vào Odoo.
//
// Bug thật 05/08/2026 21:23 — nặng nhất trong nhóm bug lên đơn, vì bot làm
// NGƯỢC HẲN ý người dùng chứ không phải hiểu thiếu:
//
//   21:23:18  bot: "Bạn có muốn thay đổi số lượng thành 10 cái không?"
//   21:23:32  NV : "tôi không muốn mua nữa đâu"
//   21:23:35  bot: tao_don_nhap → S13799, 780.000đ        ← BA GIÂY sau
//
// Prompt lúc đó bảo "hãy LÀM TIẾP việc đang dở" và model nghe theo. Bài học:
// prompt là lời khuyên, model lờ được; ranh giới phải là CODE.
import { describe, it, expect, vi } from 'vitest';
import { laYDinhDung, laToolGhi, khoeDaGhi, khoeDaGuiAnh, TOOL_GHI } from '../../../src/modules/ai/agent/y-dinh-dung.js';
import { ToolRegistry } from '../../../src/modules/ai/agent/registry.js';

describe('laYDinhDung — nhận ra lời dừng/huỷ', () => {
  it('CÂU GỐC gây bug phải bị bắt', () => {
    expect(laYDinhDung('tôi không muốn mua nữa đâu')).toBe(true);
  });

  it.each([
    'thôi không lấy nữa',
    'huỷ đơn đi',
    'thôi khỏi',
    'bỏ đi',
    'khoan đã',
    'để sau nhé',
    'không đặt nữa',
    'dừng lại',
  ])('bắt được: "%s"', (cau) => {
    expect(laYDinhDung(cau)).toBe(true);
  });

  it('bắt cả khi gõ KHÔNG DẤU — nhân viên gõ nhanh hay bỏ dấu', () => {
    expect(laYDinhDung('thoi khong lay nua')).toBe(true);
    expect(laYDinhDung('huy don di')).toBe(true);
  });

  it.each([
    'lên đơn 10 cái cho chị Lan',
    'giá bao nhiêu',
    '10 cái mà',
    'còn hàng không',
    'đơn này bao nhiêu tiền',
  ])('KHÔNG bắt nhầm lệnh thật: "%s"', (cau) => {
    expect(laYDinhDung(cau)).toBe(false);
  });

  it('tin rỗng → false, không chặn oan', () => {
    expect(laYDinhDung('')).toBe(false);
    expect(laYDinhDung('   ')).toBe(false);
  });

  it.each([
    ['lấy nữa đi, thêm 5 cái', false],   // "lay nua" KHÔNG có phủ định → là lệnh MUA
    ['mua nữa nhé', false],              // như trên
    ['khách không muốn mua nữa', true],  // có phủ định → dừng thật
    ['chị ấy chẳng lấy nữa đâu', true],
  ])('phân biệt được phủ định: "%s" → dừng=%s', (cau, mong) => {
    expect(laYDinhDung(cau)).toBe(mong);
  });

  it('CHẶN NHẦM tốn như GHI NHẦM: câu có chữ "huỷ" nhưng là tra cứu vẫn phải qua', () => {
    // "cho xem đơn đã huỷ" — người ta đang TRA, không phải bảo dừng.
    // Đây là giới hạn đã biết của cách khớp chuỗi: 'huy don' không khớp
    // 'don da huy' nên ca này qua được. Test khoá lại để đừng vô tình mở rộng
    // danh sách theo kiểu bắt cả câu này.
    expect(laYDinhDung('cho xem đơn đã huỷ tháng này')).toBe(false);
  });
});

describe('khoeDaGhi — bot không được nói dối là đã ghi', () => {
  it('CÂU THẬT bot nói khi tool bị chặn (đo 05/08) phải bị bắt', () => {
    expect(khoeDaGhi('Tôi đã cập nhật đơn S13797 thành 10 cái nguồn 12v100w.')).toBe(true);
  });

  it.each([
    'em đã tạo đơn cho anh rồi ạ',
    'đã lên đơn S13800',
    'đơn đã được tạo',
    'đã ghi nhận đơn cho chị Lan',
    'đã cập nhật số lượng thành 10',
  ])('bắt lời khoe: "%s"', (cau) => {
    expect(khoeDaGhi(cau)).toBe(true);
  });

  it.each([
    'anh có muốn em lên đơn không ạ',      // câu HỎI
    'em lên đơn ngay đây ạ',                // lời HỨA
    'giá 78.000đ một cái',                  // tra cứu
    'đơn S13797 cần sửa tay trên Odoo',     // hướng dẫn — không khoe
  ])('KHÔNG bắt nhầm: "%s"', (cau) => {
    expect(khoeDaGhi(cau)).toBe(false);
  });
});

describe('khoeDaGuiAnh — bot không được bịa đã gửi ảnh hoá đơn', () => {
  it('CÂU THẬT bot bịa gửi ảnh (đo 07/08, DNH36805) phải bị bắt', () => {
    expect(khoeDaGuiAnh('Dạ, em gửi lại ảnh đơn hàng DNH36805 cho anh Hiến ạ.')).toBe(true);
  });

  it.each([
    'em gửi ảnh hoá đơn cho anh nhé',
    'đã gửi hoá đơn cho khách',
    'em gửi lại hình đơn hàng',
    'em gửi anh ảnh đơn hàng',
  ])('bắt lời khoe gửi ảnh: "%s"', (cau) => {
    expect(khoeDaGuiAnh(cau)).toBe(true);
  });

  it.each([
    'anh có muốn em gửi ảnh hoá đơn không ạ',  // câu HỎI (nhưng có "gửi ảnh") — vẫn bắt, guard đối chiếu ảnh thật ở caller
    'đơn đã tạo xong',                          // không nhắc gửi ảnh
    'giá 78.000đ một cái',
  ])('không bắt câu không nhắc gửi ảnh: "%s"', (cau) => {
    // Câu đầu CÓ "gửi ảnh" nên khoeDaGuiAnh=true là đúng — caller vẫn chặn nếu
    // không có ảnh thật, mà câu hỏi thì không có ảnh nên chặn cũng vô hại (bot
    // hỏi lại). Chỉ khẳng định 2 câu sau chắc chắn false:
    if (!/gửi ảnh|gui anh/i.test(cau)) expect(khoeDaGuiAnh(cau)).toBe(false);
  });
});

describe('laToolGhi — biết tool nào chạm vào Odoo', () => {
  it.each(TOOL_GHI)('%s là tool GHI', (t) => {
    expect(laToolGhi(t)).toBe(true);
  });

  it.each(['tra_san_pham', 'tra_ton_kho', 'tra_danh_muc', 'chuyen_sale', 'tra_tri_thuc'])(
    '%s chỉ ĐỌC — không bị chặn',
    (t) => {
      expect(laToolGhi(t)).toBe(false);
    },
  );

  it('chịu được tiền tố Gemini `default_api.`', () => {
    expect(laToolGhi('default_api.tao_don_nhap')).toBe(true);
  });
});

describe('registry.executor(chanToolGhi) — hàng rào thật ở tầng thực thi', () => {
  const dungRegistry = () =>
    new ToolRegistry()
      .register({
        definition: { name: 'tao_don_nhap', description: 'tạo đơn', inputSchema: { type: 'object', properties: {} } },
        run: vi.fn(async () => 'ĐÃ TẠO ĐƠN'),
      })
      .register({
        definition: { name: 'tra_san_pham', description: 'tra giá', inputSchema: { type: 'object', properties: {} } },
        run: vi.fn(async () => 'giá 78.000đ'),
      });

  it('BẬT chặn → tool GHI bị từ chối, hàm run KHÔNG chạy', async () => {
    const r = dungRegistry();
    const kq = await r.executor(true)({ id: '1', name: 'tao_don_nhap', input: {} });

    expect(kq.isError).toBe(true);
    expect(kq.content).toContain('DỪNG/HUỶ');
    // Quan trọng nhất: Odoo KHÔNG bị chạm vào.
    expect(kq.content).not.toContain('ĐÃ TẠO ĐƠN');
  });

  it('BẬT chặn → tool ĐỌC vẫn chạy: "thôi khỏi lên đơn, cho xem giá thôi"', async () => {
    const r = dungRegistry();
    const kq = await r.executor(true)({ id: '1', name: 'tra_san_pham', input: {} });

    expect(kq.isError).toBeFalsy();
    expect(kq.content).toContain('78.000');
  });

  it('TẮT chặn (mặc định) → mọi thứ như cũ, không hồi quy', async () => {
    const r = dungRegistry();
    const kq = await r.executor()({ id: '1', name: 'tao_don_nhap', input: {} });

    expect(kq.isError).toBeFalsy();
    expect(kq.content).toContain('ĐÃ TẠO ĐƠN');
  });

  it('câu từ chối phải DẠY model làm gì tiếp, không chỉ nói "không"', async () => {
    const r = dungRegistry();
    const kq = await r.executor(true)({ id: '1', name: 'tao_don_nhap', input: {} });

    expect(kq.content).toContain('xác nhận đã dừng');
    expect(kq.content, 'phải nhắc xử lý đơn đã lỡ tạo').toContain('mã đơn');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Bug thật 23:38:44 10/08: khách gửi ẢNH sản phẩm hỏi "bên shop có cái này
// không". Bot đọc ảnh ra "nguồn 24V600WY" — ĐÚNG — nhưng câu trả lời chứa chữ
// "gửi ảnh", thế là hàng rào chống-hứa-lèo chặn và văng nguyên thông báo NỘI
// BỘ ra cho khách: "Bot chưa xử lý xong (Model nói đã gửi ảnh...)".
//
// Gốc: hàng rào khớp cụm "gui anh" ở BẤT KỲ đâu trong câu, nên chặn cả khi bot
// XIN khách gửi ảnh — nghĩa hoàn toàn ngược. Trước 10/08 bot chưa đọc được ảnh
// nên hiếm khi nói "gửi ảnh"; giờ đọc được thì đụng liên tục.
//
// Luật đúng: chỉ chặn khi BOT tự nhận MÌNH gửi ("em gửi ảnh", "đã gửi ảnh"),
// KHÔNG chặn khi bot bảo người khác gửi ("anh gửi ảnh giúp em").
describe('khoeDaGuiAnh — chỉ chặn khi BOT tự nhận mình gửi', () => {
  const chan = [
    'Em gửi lại ảnh hoá đơn DNH36805 nhé',
    'Dạ em đã gửi ảnh hoá đơn rồi ạ',
    'Em gửi hình đơn hàng cho anh nhé',
    'em đã gửi hoá đơn qua zalo rồi ạ',
    'Em gửi lại hoá đơn cho anh nha',
  ];
  for (const c of chan) {
    it(`CHẶN: ${JSON.stringify(c)}`, () => expect(khoeDaGuiAnh(c)).toBe(true));
  }

  const choQua = [
    // Ca thật gây bug 23:38.
    'Đã tìm thấy nguồn 24V600WY. Nhưng tôi cần xác nhận với nhân viên trước khi trả lời khách gửi ảnh này',
    // Bot XIN khách gửi ảnh — nghĩa ngược hẳn.
    'Anh/chị gửi ảnh sản phẩm giúp em nhé',
    'Dạ shop có sản phẩm này ạ. Anh gửi ảnh rõ hơn giúp em',
    'Anh gửi lại ảnh giúp em với ạ',
    'Chị chụp gửi hình cái tem giúp em nhé',
    // Nói về ảnh mà không hứa gửi.
    'Ảnh anh gửi là nguồn NB 12V300W ạ',
    'Em xem ảnh rồi, đây là loại 24V600W',
  ];
  for (const c of choQua) {
    it(`CHO QUA: ${JSON.stringify(c.slice(0, 45))}`, () => expect(khoeDaGuiAnh(c)).toBe(false));
  }
});
