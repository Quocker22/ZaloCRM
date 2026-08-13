// SPDX-License-Identifier: AGPL-3.0-or-later
// ẢNH ĐI VÀO BA LUỒNG — test xuyên vùng, vá 12/08 (ca thật 16:53).
//
// Anh Quốc: "không chỉ nhập hàng mà khách còn gửi ảnh để yêu cầu làm nhiều thứ
// khác nữa". Đúng, và đo 12/08 cho thấy vấn đề rộng hơn ca 16:53 nhiều:
//
//   luồng                          | lời dặn về khối ảnh (TRƯỚC vá 12/08)
//   -------------------------------|--------------------------------------
//   gom-don/trich-slot (lên đơn)   | CÓ (~10 dòng, vá 11/08) — mà vẫn hỏng
//   staff-command (agent thường)   | KHÔNG MỘT DÒNG NÀO
//   customer-agent (khách nhắn)    | KHÔNG MỘT DÒNG NÀO
//
// Nghĩa là ảnh + "tra tồn kho mấy cái này", ảnh + "công nợ khách này", hay
// khách gửi ảnh SP hỏi giá — đều rơi vào vùng trống. Chưa ai báo lỗi không phải
// vì chúng lành, mà vì chưa ai thử.
//
// Test này khoá HAI thứ, ở đúng chỗ chung của cả ba luồng:
//   1. `ghepCauTuAnh` — nút thắt DUY NHẤT mọi ảnh đi qua (luong-media.ts).
//   2. Cả ba prompt đều PHẢI có luật đọc khối ảnh. Thêm luồng thứ tư mà quên
//      dặn thì test này đỏ ngay, không đợi tới lúc khách hàng phát hiện.
import { describe, it, expect } from 'vitest';
import { ghepCauTuAnh } from '../../../src/modules/ai/agent/noi-zalo/luong-media.js';
import { chiLayKhoiAnh } from '../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import { trichLoiNhanVien } from '../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import { buildStaffSystemPrompt } from '../../../src/modules/ai/agent/staff-command.js';

const NOI_DUNG_ANH = 'P10 full out: 10.000 tấm | 242 thùng\nP5 full out: 1460 tấm';
const CHU_THICH = 'tạo phiếu nhập hàng giúp tôi nhà cung cấp là Trung Quốc';

describe('ghepCauTuAnh — nút thắt chung của cả ba luồng', () => {
  it('nội dung ảnh đứng TRƯỚC lời nhắn', () => {
    // Model đọc đầu câu kỹ hơn cuối câu. Chuỗi cũ để ảnh ở cuối nên khối ảnh bị
    // coi là văn bản nền — đúng cái đã xảy ra 16:53.
    const cau = ghepCauTuAnh(CHU_THICH, NOI_DUNG_ANH);

    expect(cau.indexOf('P10 full out')).toBeLessThan(cau.indexOf(CHU_THICH));
  });

  it('giữ ĐỦ cả ý định lẫn dữ liệu ảnh — mất vế nào cũng hỏng', () => {
    const cau = ghepCauTuAnh(CHU_THICH, NOI_DUNG_ANH);

    expect(cau).toContain('tạo phiếu nhập hàng');
    expect(cau).toContain('Trung Quốc');
    expect(cau).toContain('P10 full out');
    expect(cau).toContain('P5 full out');
  });

  it('nhãn là MỆNH LỆNH, không phải chú thích kỹ thuật', () => {
    const cau = ghepCauTuAnh(CHU_THICH, NOI_DUNG_ANH);

    expect(cau).toMatch(/NỘI DUNG THẬT/);
    expect(cau).toMatch(/PHẢI DÙNG/);
  });

  it('giữ tiền tố "[Khách gửi ảnh" — gom-don dò đúng chuỗi này', () => {
    // Đổi tiền tố là `coKhoiAnh`/`trichLoiNhanVien` mù, khối nội bộ lọt thẳng
    // vào tin gửi cho nhân viên (đúng lỗi B của ca 11:50).
    expect(ghepCauTuAnh(CHU_THICH, NOI_DUNG_ANH)).toContain('[Khách gửi ảnh');
    expect(ghepCauTuAnh('', NOI_DUNG_ANH)).toContain('[Khách gửi ảnh');
  });

  it('ảnh KHÔNG kèm lời nhắn → vẫn ra khối ảnh hợp lệ', () => {
    const cau = ghepCauTuAnh('', NOI_DUNG_ANH);

    expect(cau).toContain('P10 full out');
    expect(cau.startsWith('[Khách gửi ảnh')).toBe(true);
  });
});

describe('chiLayKhoiAnh — bóc riêng chữ trong ảnh để trích lại', () => {
  it('trả về nội dung ảnh, KHÔNG kèm lời nhắn và nhãn', () => {
    const chiAnh = chiLayKhoiAnh(ghepCauTuAnh(CHU_THICH, NOI_DUNG_ANH));

    expect(chiAnh).toContain('P10 full out');
    expect(chiAnh).toContain('P5 full out');
    // Lời nhắn phải bị bỏ — đưa mỗi danh sách hàng trần cho model thì nó không
    // còn gì để bám vào mà coi khối ảnh là nền.
    expect(chiAnh).not.toContain('tạo phiếu nhập hàng');
    expect(chiAnh).not.toContain('[Khách gửi ảnh');
    expect(chiAnh).not.toContain('NỘI DUNG THẬT');
  });

  it('giữ dấu ":" TRONG nội dung ảnh — "P10 full out: 10.000 tấm"', () => {
    // Cắt ở dấu ':' CUỐI thay vì ':' đầu là mất sạch dòng hàng.
    expect(chiLayKhoiAnh(ghepCauTuAnh('', NOI_DUNG_ANH))).toContain('P10 full out: 10.000 tấm');
  });

  it('câu không có ảnh → chuỗi rỗng, không bịa', () => {
    expect(chiLayKhoiAnh('lên đơn cho anh Long 10 cái')).toBe('');
  });

  it('chịu được chuỗi CŨ — tin đang bay giữa chừng lúc deploy', () => {
    const cauCu = `${CHU_THICH}\n[Khách gửi ảnh, nội dung trong ảnh: ${NOI_DUNG_ANH}]`;

    expect(chiLayKhoiAnh(cauCu)).toContain('P10 full out');
    expect(chiLayKhoiAnh(cauCu)).not.toContain('tạo phiếu nhập hàng');
  });
});

describe('trichLoiNhanVien — không vỡ khi ảnh đảo lên TRƯỚC', () => {
  it('lấy được lời nhắn dù khối ảnh đứng trước nó', () => {
    // Bản cũ giả định ảnh luôn ở CUỐI (`slice(0, batDauKhoi)`). Đảo thứ tự mà
    // không sửa hàm này thì `batDauKhoi === 0` → lời nhắn bị vứt sạch, mọi câu
    // "Em vẫn chưa khớp được …" mất phần trích.
    const loi = trichLoiNhanVien(ghepCauTuAnh('đây lấy từ trong ảnh ra', NOI_DUNG_ANH));

    expect(loi).toContain('đây lấy từ trong ảnh ra');
    expect(loi).not.toContain('[Khách gửi ảnh');
    expect(loi).not.toContain('P10 full out');
  });

  it('ảnh không kèm lời nhắn → rỗng (caller bỏ luôn phần trích)', () => {
    expect(trichLoiNhanVien(ghepCauTuAnh('', NOI_DUNG_ANH))).toBe('');
  });

  it('vẫn chạy đúng với chuỗi CŨ (ảnh ở cuối)', () => {
    const cauCu = `đây lấy từ trong ảnh ra\n[Khách gửi ảnh, nội dung trong ảnh: ${NOI_DUNG_ANH}]`;
    const loi = trichLoiNhanVien(cauCu);

    expect(loi).toContain('đây lấy từ trong ảnh ra');
    expect(loi).not.toContain('P10 full out');
  });
});

describe('CẢ BA LUỒNG phải có luật đọc khối ảnh', () => {
  // Đây là hàng rào chống TÁI PHÁT: 11/08 vá đúng một luồng, 12/08 hỏng lại vì
  // hai luồng kia trống. Thêm luồng thứ tư mà quên dặn thì đỏ ở đây.
  it('agent thường (staff-command) có luật đọc ảnh', () => {
    const p = buildStaffSystemPrompt('LEDNELIA - shop đèn LED & phụ kiện điện');

    expect(p).toContain('[Khách gửi ảnh');
    expect(p).toMatch(/ĐỌC TỪ ẢNH/);
    expect(p).toMatch(/ĐỪNG hỏi lại/);
  });

  it('luồng khách (customer-agent) có luật đọc ảnh', async () => {
    // customer-agent dựng prompt theo cấu hình org nên đọc thẳng source: chỉ
    // cần chắc luật CÓ MẶT, còn hành vi đã do hai khối test trên khoá.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../../src/modules/ai/agent/customer-agent.ts', import.meta.url), 'utf8');

    expect(src).toContain('[Khách gửi ảnh');
    expect(src).toMatch(/ĐỌC TỪ ẢNH/);
    // Luồng khách nói với KHÁCH THẬT → phải cấm lộ khối nội bộ ra ngoài.
    expect(src).toMatch(/không chép nhãn/i);
  });

  it('gom đơn (trich-slot) giữ nguyên luật đọc ảnh có từ 11/08', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../../src/modules/ai/agent/noi-zalo/gom-don/trich-slot.ts', import.meta.url), 'utf8');

    expect(src).toContain('NỘI DUNG ẢNH');
  });
});

describe('bóc mention khỏi CHÚ THÍCH ẢNH — ca thật 18:31 12/08', () => {
  // Tin ảnh thật: title "Nelia tạo phiếu nhập hàng, nhà cung cấp Trung Quốc
  // @Tiểu Mã Nelia", mentions [{pos:51,len:14}]. Không bóc → model trích slot
  // lấy "Tiểu Mã Nelia" (TÊN BOT) làm tên NCC, bot đáp 'không tìm thấy NCC
  // "Tiểu Mã Nelia"'. Đường text bóc từ 06/08; đường ảnh 12/08 mới theo kịp.
  it('bocMention áp lên title cắt đúng tag theo pos/len', async () => {
    const { bocMention } = await import('../../../src/modules/ai/agent/noi-zalo/boc-mention.js');
    const title = 'Nelia tạo phiếu nhập hàng, nhà cung cấp Trung Quốc @Tiểu Mã Nelia';

    const sach = bocMention(title, [{ uid: '630640428799521839', pos: 51, len: 14 }]);

    expect(sach).not.toContain('@Tiểu Mã Nelia');
    expect(sach).toContain('nhà cung cấp Trung Quốc');
  });

  it('xuLyTinMedia nhận mentions và chú thích tới model KHÔNG còn tag', async () => {
    // Khoá hợp đồng ở tầng source: docVaChuyenTiep phải bóc mention trước khi
    // đưa chú thích cho model — grep chuỗi gọi trong luong-media.ts.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../../src/modules/ai/agent/noi-zalo/luong-media.ts', import.meta.url), 'utf8');

    expect(src).toMatch(/bocMention\(bocChuThich\(/);
  });

  it('mentions rỗng/null → chú thích giữ nguyên, không ném lỗi', async () => {
    const { bocMention } = await import('../../../src/modules/ai/agent/noi-zalo/boc-mention.js');

    expect(bocMention('tạo phiếu nhập', null)).toBe('tạo phiếu nhập');
    expect(bocMention('tạo phiếu nhập', [])).toBe('tạo phiếu nhập');
  });
});

describe('bocDongTuKhoiAnh — parse dòng hàng bằng CODE, không nhờ model (18:39 12/08)', () => {
  // Đo prod: model chính nhìn danh sách trần vẫn trả 0 dòng hai lượt liền.
  // Nội dung ảnh có hợp đồng format từ loiDanDocAnh → parse code là đường
  // chính. Các ca dưới lấy NGUYÊN VĂN từ ảnh thật 12/08.
  it('dạng chuẩn "tên: số đơn vị" → sp + sl', async () => {
    const { bocDongTuKhoiAnh } = await import('../../../src/modules/ai/agent/noi-zalo/gom-don/index.js');

    const dong = bocDongTuKhoiAnh('- P5 full out: 1460 tấm\n- Quạt gió: 160 cái');

    expect(dong).toEqual([{ sp: 'P5 full out', sl: 1460 }, { sp: 'Quạt gió', sl: 160 }]);
  });

  it('số kiểu VN "10.000" = mười nghìn, phần "| 242 thùng" là ghi chú phụ', async () => {
    const { bocDongTuKhoiAnh } = await import('../../../src/modules/ai/agent/noi-zalo/gom-don/index.js');

    const dong = bocDongTuKhoiAnh('- P10 full out: 10.000 tấm | 242 thùng');

    expect(dong).toEqual([{ sp: 'P10 full out', sl: 10000 }]);
  });

  it('tên hàng chứa ":" ("DM: 12V400W: 1616") → cắt ở dấu CUỐI', async () => {
    const { bocDongTuKhoiAnh } = await import('../../../src/modules/ai/agent/noi-zalo/gom-don/index.js');

    const dong = bocDongTuKhoiAnh('- DM: 12V400W: 1616\n- NB-12V400W: 3030');

    expect(dong).toEqual([{ sp: 'DM: 12V400W', sl: 1616 }, { sp: 'NB-12V400W', sl: 3030 }]);
  });

  it('dòng "Tổng: 242 thùng" là tổng kết, KHÔNG phải hàng → bỏ', async () => {
    const { bocDongTuKhoiAnh } = await import('../../../src/modules/ai/agent/noi-zalo/gom-don/index.js');

    const dong = bocDongTuKhoiAnh('- P5 full out: 1460 tấm\nTổng: 242 thùng');

    expect(dong).toEqual([{ sp: 'P5 full out', sl: 1460 }]);
  });

  it('dòng không có số / không có ":" → bỏ, không bịa', async () => {
    const { bocDongTuKhoiAnh } = await import('../../../src/modules/ai/agent/noi-zalo/gom-don/index.js');

    const dong = bocDongTuKhoiAnh('Danh sách hàng nhập\n- Cabin 960*960*120: 80 cái\nghi chú: hàng về kho A');

    expect(dong).toEqual([{ sp: 'Cabin 960*960*120', sl: 80 }]);
  });

  it('ảnh thật đủ 15 dòng → ra đủ 15, không sót', async () => {
    const { bocDongTuKhoiAnh } = await import('../../../src/modules/ai/agent/noi-zalo/gom-don/index.js');
    const anhThat = [
      '- P10 full out: 10.000 tấm | 242 thùng', '- P5 full out: 1460 tấm',
      '- Cabin 960*960*120: 80 cái', '- Quạt gió: 160 cái', '- RY3-800W: 109',
      '- 12V600W: 1263', '- DM: 12V400W: 1616', '- NB-12V400W: 3030',
      '- NB-12V60W: 970', '- NB-12V100W: 873', '- NB-12V200W: 556',
      '- 5V60A mỏng: 1131', '- Led thanh toả 12V lixin trong nhà: 20 thùng',
      '- Led thanh toả 12V lixin ngoài trời: 15 thùng', '- 4B 220V lixin trong nhà: 30 thùng',
    ].join('\n');

    const dong = bocDongTuKhoiAnh(anhThat);

    expect(dong).toHaveLength(15);
    expect(dong[0]).toEqual({ sp: 'P10 full out', sl: 10000 });
    expect(dong[14]).toEqual({ sp: '4B 220V lixin trong nhà', sl: 30 });
  });
});

describe('đọc file PDF (13/08 — ca "Phiếu nhập hàng P04520.pdf")', () => {
  it('docPdf: PDF thật → chữ; magic bytes sai → null (đuôi tên giả mạo được, 5 byte đầu thì không)', async () => {
    const { docPdf } = await import('../../../src/modules/ai/agent/noi-zalo/doc-anh.js');

    const that = await docPdf(
      { goiModelFile: async () => 'Led Dây chữ S 6mm: 6.000, 8.300đ', taiFile: async () => Buffer.from('%PDF-1.4 abc') },
      { url: 'http://x/a.pdf', tenFile: 'P04520.pdf' },
    );
    expect(that).toContain('Led Dây');

    const gia = await docPdf(
      { goiModelFile: async () => 'x', taiFile: async () => Buffer.from('MZjunk-khong-phai-pdf') },
      { url: 'http://x/a.pdf', tenFile: 'gia.pdf' },
    );
    expect(gia).toBeNull();
  });

  it('model trả rỗng → null + có log (không câm)', async () => {
    const { docPdf } = await import('../../../src/modules/ai/agent/noi-zalo/doc-anh.js');
    const { logger } = await import('../../../src/shared/utils/logger.js');
    const { vi } = await import('vitest');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    const kq = await docPdf(
      { goiModelFile: async () => '', taiFile: async () => Buffer.from('%PDF-1.4') },
      { url: 'http://x/a.pdf', tenFile: 'a.pdf' },
    );

    expect(kq).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('nhận diện PDF theo TÊN FILE trong title — file khác (xlsx) vẫn đường báo người', async () => {
    // Khoá hợp đồng nhận diện trong luong-media (đuôi .pdf trên title).
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../../src/modules/ai/agent/noi-zalo/luong-media.ts', import.meta.url), 'utf8');

    expect(src).toMatch(/laPdfFile = contentType === 'file'/);
    expect(src).toMatch(/\\.pdf/);
    // Tag thừa hưởng từ tin lệnh trước — không có thì file trong nhóm chết ở cổng.
    expect(src).toMatch(/tagThuaHuong/);
  });
});
