// SPDX-License-Identifier: AGPL-3.0-or-later
// Giám sát giai đoạn 2 (27/08) — đo 24h đầu: 20 bản nháp bị sửa, ~8 lỗi thật
// (độc thoại chép ra tin, nhại câu NV), ~12 báo động giả (hỏi chọn 1/N là đúng;
// danh sách số từ tool bị phán bia_so). Fixture = bản nháp THẬT 26/08.
import { describe, it, expect, vi } from 'vitest';
import {
  lotDocThoai, soMaTrong, giuSoMaDung, soLaTrongBanNhap, giamSatTraLoi, tenKhachLech, maDonTrong,
} from '../../../src/modules/ai/agent/giam-sat.js';
import type { AgentTurn } from '../../../src/modules/ai/agent/types.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
const turn = (input: Record<string, unknown>): AgentTurn => ({
  text: '', stopReason: 'tool_use', raw: null, usage, toolCalls: [{ id: 'g1', name: 'phan_quyet', input }],
});

describe('lotDocThoai — độc thoại replay 27/08 (nói về NV ở ngôi thứ ba)', () => {
  it('lột hết 4 đoạn nghĩ, giữ câu hỏi thật gửi NV', () => {
    const nhap = [
      'Đây là loại 3? Hay có thể là sửa đơn?',
      'Nhìn vào ngữ cảnh: đơn đã lên với "4 bóng Lixin 220V trong nhà Trung tính 4000K". Tin mới nhắc lại "4 bóng lixin 220V trung tính" — trùng khớp với thông tin đơn đã tạo. Có vẻ nhân viên đang xác nhận lại hoặc gõ lại.',
      'Tuy nhiên, tin này khá mơ hồ — nó giống như chỉ lặp lại mô tả sản phẩm đã có trên đơn. Cần hỏi lại để chắc chắn ý nhân viên.',
      'Đơn S99001 của anh Việt đã có 400 × Led 4 bóng Lixin 220V trong nhà Trung tính 4000K rồi ạ. Anh/chị muốn sửa gì trên đơn này không?',
    ].join('\n\n');
    const { sach, daLot } = lotDocThoai(nhap, '4 bóng lixin 220V trung tính');
    expect(daLot.length).toBe(3);
    expect(sach).toBe('Đơn S99001 của anh Việt đã có 400 × Led 4 bóng Lixin 220V trong nhà Trung tính 4000K rồi ạ. Anh/chị muốn sửa gì trên đơn này không?');
  });
});

describe('lotDocThoai — "Nhân viên chỉ nhắn…" + "Hỏi lại để xác nhận" (replay S3 27/08)', () => {
  it('đoạn kế hoạch bị lột, giữ câu hỏi thật gửi NV', () => {
    const { sach, daLot } = lotDocThoai('Nhân viên chỉ nhắn "a", chưa rõ ý định gì. Hỏi lại để xác nhận.\n\nAnh/chị nhắn "a" là ý gì ạ? Em đang đợi xác nhận đơn S99004.', 'a');
    expect(daLot.length).toBe(1);
    expect(sach).toBe('Anh/chị nhắn "a" là ý gì ạ? Em đang đợi xác nhận đơn S99004.');
  });
});

describe('lotDocThoai — độc thoại thật 26/08', () => {
  it('"có bạn gái chưa": bỏ đoạn "Tôi đáp ngắn, không gọi tool", giữ câu nói với NV', () => {
    const nhap = '"Có bạn gái chưa" là câu đùa/cá nhân, không liên quan công việc. Tôi đáp ngắn, không gọi tool.\n\n' +
      'Chưa có đâu ạ, em còn bận trông kho làm đơn cùng anh chị đây. 😄\n\nCó gì cần lên đơn, in đơn hay tra cứu thì anh/chị cứ gọi em nhé.';
    const { sach, daLot } = lotDocThoai(nhap, 'có bạn gái chưa');
    expect(daLot).toHaveLength(1);
    expect(sach).not.toMatch(/gọi tool|Tôi đáp/);
    expect(sach).toContain('Chưa có đâu ạ');
    expect(sach).toContain('cứ gọi em nhé');
  });

  it('"vẫn chưa dùng ảnh": bỏ "Nhân viên đang nhắn đùa… Đây là câu trả lời…"', () => {
    const nhap = 'Nhân viên đang nhắn đùa là chưa dùng ảnh để đọc được. Đây là câu trả lời cho việc đang làm dở — tìm khách "Đây e" để lên đơn.\n\n' +
      'Anh/chị đang cần lên đơn led đơn, nhưng em vẫn chưa biết chính xác khách là ai trong danh sách. Anh/chị gõ giúp em tên đầy đủ hoặc SĐT của khách để em lên đơn cho chuẩn nhé ạ.';
    const { sach } = lotDocThoai(nhap, "vẫn chưa dùng ảnh để đọc đc :')");
    expect(sach).not.toContain('Nhân viên đang');
    expect(sach).toMatch(/^Anh\/chị đang cần lên đơn/);
  });

  it('"Theo luật nhân viên: …" và độc thoại "Tôi cần dùng báo cáo linh hoạt… Hãy thử…" đều bị lột', () => {
    const a = lotDocThoai('Theo luật nhân viên: sau khi in đơn, nếu khách yêu cầu \'xuất đơn\' thì xuất luôn không hỏi.\n\nĐơn S15315 đã xuất hoá đơn INV/2026/028337 rồi ạ.', 'xuất đơn');
    expect(a.sach).toBe('Đơn S15315 đã xuất hoá đơn INV/2026/028337 rồi ạ.');
    const b = lotDocThoai('Nhân viên hỏi khách nào mang lại lợi nhuận cao nhất. Tôi cần dùng báo cáo linh hoạt để đo lợi nhuận.\n\nHãy thử báo cáo linh hoạt với khách hàng.\n\nDạ anh, hệ thống hiện chưa xuất được lợi nhuận theo từng khách ạ.', 'khách nào lợi nhuận cao nhất');
    expect(b.daLot).toHaveLength(2);
    expect(b.sach).toBe('Dạ anh, hệ thống hiện chưa xuất được lợi nhuận theo từng khách ạ.');
  });

  it('tật NHẠI câu NV ở đầu: \'Anh/chị nhắn "Có bao nhiêu người tên Linh" ạ.\' và "in giúp tôi hoá đơn INV/… — em đã in…"', () => {
    const a = lotDocThoai('Anh/chị nhắn "Có bao nhiêu người tên Linh" ạ. Em tra được vài trường hợp, nhưng danh sách bị cắt nên chưa đếm hết được.', 'Có bao nhiêu người tên Linh.');
    expect(a.sach).toMatch(/^Em tra được vài trường hợp/);
    const b = lotDocThoai('in giúp tôi hoá đơn INV/2026/028291 — em đã in bản này rồi ở lượt trước (Anh Văn Công · 1.400.000đ, bản không giá).', 'in giúp tôi hoá đơn INV/2026/028291');
    expect(b.sach).toMatch(/^Em đã in bản này rồi/);
  });

  it('3 ca lọt lưới lần replay đầu: "Vậy trả lời thẳng" dính dòng, "Thực tế hãy cố gắng…", nhại có chèn chữ / "Tin nhắn anh/chị nói"', () => {
    const a = lotDocThoai('Vậy trả lời thẳng\nAnh ơi, hệ thống chỉ xuất được lợi nhuận theo khoảng thời gian ạ.', 'Anh vấn mang lại lợi nhuận là bao nhiêu.');
    expect(a.sach).toBe('Anh ơi, hệ thống chỉ xuất được lợi nhuận theo khoảng thời gian ạ.');
    const b = lotDocThoai('Thực tế hãy cố gắng dùng báo cáo linh hoạt theo khách với doanh thu, rồi nói rõ chưa có dữ liệu lợi nhuận theo khách.\n\nDạ anh, em chưa có dữ liệu lợi nhuận theo từng khách ạ.', 'khách nào lợi nhuận cao nhất');
    expect(b.sach).toBe('Dạ anh, em chưa có dữ liệu lợi nhuận theo từng khách ạ.');
    const c = lotDocThoai('in giúp tôi hoá đơn INV/2026/028291 — em đã in bản này rồi ở lượt trước ạ.', 'in hoá đơn INV/2026/028291');
    expect(c.sach).toBe('Em đã in bản này rồi ở lượt trước ạ.');
    const d = lotDocThoai('Tin nhắn anh/chị nói "đúng, in đơn KH000129" — nhưng em thấy KH000129 chưa có đơn nào ạ.', '[Trả lời tin: "…"] đúng, in đơn KH000129');
    expect(d.sach).toBe('Nhưng em thấy KH000129 chưa có đơn nào ạ.');
  });

  it('bản nháp bình thường (hỏi chọn 1/N khách) → KHÔNG đụng gì; lột xong mà rỗng → giữ bản gốc', () => {
    const chon = 'Anh/chị ơi, "anh vũ hải" có 3 khách khớp:\n1) Anh Vũ Hải · KH000147\n2) ANh Luật Vũ - Hải Dương · KH002520AC\n3) Anh Vũ Thới Hải Phòng · KH001874\n\nAnh/chị xác nhận in đơn của KH000147 đúng không ạ?';
    expect(lotDocThoai(chon, 'in đơn anh vũ hải')).toEqual({ sach: chon, daLot: [] });
    const chiDocThoai = 'Tôi cần hỏi lại nhân viên.';
    expect(lotDocThoai(chiDocThoai, 'x').sach).toBe(chiDocThoai);
  });
});

describe('bản nháp TOÀN độc thoại (model chưa viết câu trả lời)', () => {
  const VAO = {
    cauNv: 'Anh vấn mang lại lợi nhuận là bao nhiêu.', lichSu: [], log: [],
    traLoi: 'Nhân viên hỏi "Anh Vấn mang lại lợi nhuận là bao nhiêu". Đây là câu hỏi về lợi nhuận theo khách.\n\nTôi đã nói ở lượt trước là không có dữ liệu.\n\nVậy tôi cần trả lời rằng không có dữ liệu lợi nhuận theo khách. Không gọi tool.',
  };
  it('lotDocThoai gắn cờ toanBoDocThoai; model TIMEOUT → gửi câu nói-thật chứ KHÔNG phơi độc thoại', async () => {
    expect(lotDocThoai(VAO.traLoi, VAO.cauNv).toanBoDocThoai).toBe(true);
    const pq = await giamSatTraLoi(vi.fn(() => new Promise<AgentTurn>(() => {})), VAO, 30);
    expect(pq.traLoiSua).toMatch(/CHƯA thực hiện được/);
    expect(pq.traLoiSua).not.toMatch(/Tôi|gọi tool/);
  });
  it('model bảo ok=true → không tin, vẫn thay bằng câu nói-thật; model đưa bản sửa tử tế → dùng bản sửa', async () => {
    const a = await giamSatTraLoi(vi.fn(async () => turn({ ok: true, loi: [] })), VAO);
    expect(a.ok).toBe(false);
    expect(a.traLoiSua).toMatch(/CHƯA thực hiện được/);
    const b = await giamSatTraLoi(vi.fn(async () => turn({ ok: false, loi: ['lo_noi_bo'], tra_loi_sua: 'Dạ anh, hệ thống chưa có lợi nhuận theo từng khách ạ.' })), VAO);
    expect(b.traLoiSua).toBe('Dạ anh, hệ thống chưa có lợi nhuận theo từng khách ạ.');
  });
});

describe('tên khách lệch / mã đơn (harness code-side)', () => {
  it('tool "· Tấn Anh - Bình Định · 1.433.456đ" mà bản nháp nói QC Bách Phát → lệch; bản nháp có nhắc → không', () => {
    const log = [{ toolName: 'in_hoa_don', input: {}, output: 'Đã xếp hàng in hoá đơn INV/2026/028301 (đơn S15274) · Tấn Anh - Bình Định · 1.433.456đ — bản KHÔNG GIÁ.', thanhCong: true, durationMs: 1, iteration: 1 }];
    expect(tenKhachLech(log, 'Em đã xếp in đơn QC Bách Phát rồi ạ.')).toEqual(['Tấn Anh - Bình Định']);
    expect(tenKhachLech(log, 'Em đã xếp in hoá đơn của anh Tấn Anh Bình Định ạ.')).toEqual([]);
    expect(tenKhachLech([{ toolName: 'tao_don_nhap', input: {}, output: 'Đơn cho Anh Vũ Hải (KH000147): 8 × Nguồn', thanhCong: true, durationMs: 1, iteration: 1 }], 'Đã lên đơn cho Vũ Hải')).toEqual([]);
  });
  it('prod 07:14 27/08: tra_san_pham "…khách cần…" KHÔNG được coi là tên khách (chỉ tool hành động mới có chủ đơn)', () => {
    const log = [{ toolName: 'tra_san_pham', input: { ten: 'fa 50w' }, output: 'Tìm thấy 14 sản phẩm: id=246 | Fa SMD 50w Màu Trắng (cái) | CHƯA CÓ GIÁ — hỏi khách cần loại nào', thanhCong: true, durationMs: 1, iteration: 1 }];
    expect(tenKhachLech(log, 'Có chứ, "fa 50w" có 3 loại… lên cho khách Qc T&T ạ.')).toEqual([]);
  });

  it('prod 07:30 27/08: bản nháp "Tin này không thuộc 3 loại…" bị lột; bản SỬA của model mang "Câu này là trao đổi nội bộ, không nên gửi…" cũng bị lột', async () => {
    const nhap = 'Tin này không thuộc 3 loại — đang là câu hỏi trao đổi nhỏ về vụ in đơn có vấn đề.\n\nVụ in đơn không phải chỗ em xử lý được, anh/chị xem lại máy in giúp em, còn chuyện đơn hàng em hỗ trợ tiếp ạ.';
    expect(lotDocThoai(nhap, 'Vậy ak').sach).toMatch(/^Vụ in đơn không phải chỗ em/);
    const generate = vi.fn(async () => turn({ ok: false, loi: ['lo_noi_bo'], tra_loi_sua: 'Câu này là trao đổi nội bộ, không nên gửi như hiện tại.\nVấn đề in ấn máy in vui lòng kiểm tra bên kỹ thuật ạ.' }));
    const pq = await giamSatTraLoi(generate, { cauNv: 'Vậy ak', lichSu: [], log: [], traLoi: nhap });
    expect(pq.traLoiSua).not.toMatch(/không nên gửi|Câu này/);
    expect(pq.traLoiSua).toContain('kiểm tra bên kỹ thuật');
  });

  it('maDonTrong lấy S…/INV… không trùng, tối đa 4', () => {
    expect(maDonTrong('in S15274 và s15274, hoá đơn INV/2026/028301, S1 không tính')).toEqual(['S15274', 'INV/2026/028301']);
  });
});

describe('mã/số — bịa và làm mất', () => {
  it('soMaTrong bắt mã đơn, số hoá đơn, mã KH, tiền có chấm/đ/k/tr', () => {
    expect(soMaTrong('S15333 · INV/2026/028313 · KH000147 · 1.440.000đ · 180k · 445,3tr')).toEqual(
      expect.arrayContaining(['s15333', 'inv/2026/028313', 'kh000147', '1440000', '180000', '445300000']),
    );
  });

  it('bản sửa cắt mất số đúng của tool → giuSoMaDung=false; giữ đủ → true', () => {
    const log = [{ toolName: 'bao_cao_tong_quan', input: {}, output: '1. Anh Cảnh Tam Kỳ: 445,3tr\n2. LED - Chị Thư Led: 415,3tr', thanhCong: true, durationMs: 1, iteration: 1 }];
    const goc = 'Top khách tháng 7:\n1. Anh Cảnh Tam Kỳ: 445,3tr\n2. LED - Chị Thư Led: 415,3tr';
    expect(giuSoMaDung(goc, 'Dạ đây là top khách tháng 7 ạ, em đã gửi ảnh.', log)).toBe(false);
    expect(giuSoMaDung(goc, 'Top tháng 7: Anh Cảnh Tam Kỳ 445,3tr; Chị Thư Led 415,3tr.', log)).toBe(true);
  });

  it('soLaTrongBanNhap: số không có ở tool/câu NV/lịch sử → nghi bịa; số có trong tool → không', () => {
    const vao = {
      cauNv: 'in đơn QC bách phát', lichSu: [],
      log: [{ toolName: 'in_hoa_don', input: { ma_don: 'S15274' }, output: 'Đã xếp hàng in hoá đơn INV/2026/028301 · Tấn Anh - Bình Định · 1.433.456đ', thanhCong: true, durationMs: 1, iteration: 1 }],
      traLoi: '',
    };
    expect(soLaTrongBanNhap(vao, 'Em đã xếp in đơn QC Bách Phát 0869130883, tổng 2.350.000đ ạ.')).toEqual(['2350000']);
    expect(soLaTrongBanNhap(vao, 'Đã xếp hàng in INV/2026/028301 · 1.433.456đ ạ.')).toEqual([]);
  });
});

describe('giamSatTraLoi — code lột trước, model chỉ soi phần còn lại', () => {
  const VAO = {
    cauNv: 'có bạn gái chưa', lichSu: [], log: [],
    traLoi: '"Có bạn gái chưa" là câu đùa/cá nhân. Tôi đáp ngắn, không gọi tool.\n\nChưa có đâu ạ, em còn bận làm đơn cùng anh chị đây. 😄',
  };

  it('model phán ok → vẫn gửi bản ĐÃ LỘT độc thoại; prompt cho model là bản sau lột + ghi chú CODE ĐÃ LỘT', async () => {
    const generate = vi.fn(async () => turn({ ok: true, loi: [] }));
    const pq = await giamSatTraLoi(generate, VAO);
    expect(pq.ok).toBe(false);
    expect(pq.loi).toEqual(['lo_noi_bo']);
    expect(pq.traLoiSua).toBe('Chưa có đâu ạ, em còn bận làm đơn cùng anh chị đây. 😄');
    expect(pq.docThoaiBiLot).toHaveLength(1);
    const nd = String(generate.mock.calls[0][0].messages[0].content);
    expect(nd).toContain('CODE ĐÃ LỘT');
    expect(nd).not.toContain('không gọi tool.');
  });

  it('model TIMEOUT → fail-open vẫn gửi bản đã lột', async () => {
    const generate = vi.fn(() => new Promise<AgentTurn>(() => {}));
    const pq = await giamSatTraLoi(generate, VAO, 30);
    expect(pq.nguon).toBe('fail_open');
    expect(pq.traLoiSua).toBe('Chưa có đâu ạ, em còn bận làm đơn cùng anh chị đây. 😄');
  });

  it('model sửa mà bản sửa CẮT MẤT số đúng của tool → bỏ bản sửa, dùng bản gốc (banSuaMatSo)', async () => {
    const log = [{ toolName: 'bao_cao_tong_quan', input: {}, output: '1. Anh Cảnh Tam Kỳ: 445,3tr\n2. Chị Thư Led: 415,3tr', thanhCong: true, durationMs: 1, iteration: 1 }];
    const goc = 'Dạ đúng rồi anh — biểu đồ cột doanh số top khách tháng 7 đây ạ:\n1. Anh Cảnh Tam Kỳ: 445,3tr\n2. Chị Thư Led: 415,3tr';
    const generate = vi.fn(async () => turn({ ok: false, loi: ['bia_so'], tra_loi_sua: 'Dạ em đã gửi biểu đồ top khách tháng 7 kèm ảnh ạ.' }));
    const pq = await giamSatTraLoi(generate, { cauNv: 'lập biểu đồ cột', lichSu: [], log, traLoi: goc });
    expect(pq.banSuaMatSo).toBe(true);
    expect(pq.ok).toBe(true); // bản gốc không có gì để lột → gửi nguyên
    expect(pq.traLoiSua).toBeUndefined();
  });

  it('bản nháp bịa tổng tiền → prompt cho model có CODE PHÁT HIỆN số lạ, phán quyết mang soLa để đếm', async () => {
    const log = [{ toolName: 'in_hoa_don', input: { ma_don: 'S15274' }, output: 'Đã xếp hàng in hoá đơn INV/2026/028301 · Tấn Anh - Bình Định · 1.433.456đ', thanhCong: true, durationMs: 1, iteration: 1 }];
    const generate = vi.fn(async () => turn({ ok: false, loi: ['bia_so'], tra_loi_sua: 'Em đã xếp hàng in hoá đơn INV/2026/028301 · Tấn Anh - Bình Định · 1.433.456đ ạ.' }));
    const pq = await giamSatTraLoi(generate, { cauNv: 'in đơn QC bách phát', lichSu: [], log, traLoi: 'Em đã xếp in đơn QC Bách Phát, tổng 2.350.000đ ạ.' });
    expect(String(generate.mock.calls[0][0].messages[0].content)).toContain('CODE PHÁT HIỆN mã/số tiền KHÔNG có');
    expect(pq.soLa).toEqual(['2350000']);
    expect(pq.traLoiSua).toContain('1.433.456');
  });
});
