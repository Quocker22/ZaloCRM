// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: helper dừng-có-log — cấu trúc hoá bài học "cổng im lặng".
//
// Bug gốc (2026-08-05): bot không trả lời, HAI cổng đầu của handler quên log,
// mất cả tiếng gọi lại từng hàm bằng tay mới tìm ra chỗ dừng. Helper này làm
// cho việc thoát sớm không kèm lý do trở thành KHÔNG VIẾT NỔI.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { taoDung, taoMoc } from '../../../src/modules/ai/agent/noi-zalo/dung.js';
import { logger } from '../../../src/shared/utils/logger.js';

beforeEach(() => {
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'info').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('taoDung — mọi lần dừng đều có log', () => {
  it('trả false ĐÚNG KIỂU để dùng thẳng trong `return dung(...)`', () => {
    const dung = taoDung('nv');
    const kq: false = dung('thử'); // gán vào kiểu `false` — sai kiểu là tsc chặn

    expect(kq).toBe(false);
  });

  it('ghi warn với prefix thống nhất [agent/<luồng>] dừng: <lý do>', () => {
    taoDung('nv')('công tắc tắt');
    taoDung('khach')('thiếu thread');

    expect(logger.warn).toHaveBeenCalledWith({}, '[agent/nv] dừng: công tắc tắt');
    expect(logger.warn).toHaveBeenCalledWith({}, '[agent/khach] dừng: thiếu thread');
  });

  it('chi tiết đi kèm để log tự nó đủ chẩn đoán, khỏi gọi lại hàm bằng tay', () => {
    taoDung('nv')('không qua cổng', { senderUid: '123', isSelf: false });

    expect(logger.warn).toHaveBeenCalledWith(
      { senderUid: '123', isSelf: false },
      '[agent/nv] dừng: không qua cổng',
    );
  });
});

describe('taoMoc — trọn vòng đời một lượt trong log', () => {
  it('BẮT ĐẦU trả mốc thời gian, XONG ghi ms trôi qua', () => {
    const moc = taoMoc('khach');
    const t0 = moc.batDau({ noiDung: 'chào' });
    moc.xong(t0, { soTool: 2 });

    expect(logger.info).toHaveBeenCalledWith({ noiDung: 'chào' }, '[agent/khach] BẮT ĐẦU xử lý');
    const [chiTiet, msg] = vi.mocked(logger.info).mock.calls[1] as [Record<string, unknown>, string];
    expect(msg).toBe('[agent/khach] XONG');
    expect(chiTiet.soTool).toBe(2);
    expect(typeof chiTiet.ms).toBe('number');
  });
});
