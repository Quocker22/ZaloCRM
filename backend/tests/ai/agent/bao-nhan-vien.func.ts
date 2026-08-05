// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: khi bot bí, khách KHÔNG được rơi vào im lặng.
//
// Bug gốc (05/08/2026): mọi nhánh chua_hoan_tat / lỗi-sau-tool đều im lặng
// hoàn toàn — khách chờ vô vọng nếu nhân viên không tình cờ mở CRM. Test này
// khoá hợp đồng của lớp thay thế: giữ chân + báo nhân viên có ngữ cảnh.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/modules/ai/agent/noi-zalo/gui-zalo.js', () => ({
  guiTin: vi.fn(async () => {}),
}));

import { guiTin } from '../../../src/modules/ai/agent/noi-zalo/gui-zalo.js';
import {
  baoNhanVien,
  xoaLichSuBao,
  CAU_GIU_CHAN,
  type GoiNguCanh,
} from '../../../src/modules/ai/agent/noi-zalo/bao-nhan-vien.js';
import { logger } from '../../../src/shared/utils/logger.js';
import type { DichGui } from '../../../src/modules/ai/agent/noi-zalo/gui-zalo.js';

const DICH: DichGui = {
  accountId: 'acc-1', threadId: 'khach-thread', threadType: 0,
  zaloUid: '123', tenKhach: 'Anh Long', sdtKhach: '0901234567',
};
const GOI: GoiNguCanh = {
  conversationId: 'conv-1',
  lyDo: 'Model trả câu rỗng sau khi gọi tool.',
  tinKhach: 'lấy anh 5 cuộn led 5m',
  soToolDaChay: 2,
};

let goc: NodeJS.ProcessEnv;
beforeEach(() => {
  goc = { ...process.env };
  process.env.AI_AGENT_THREAD_BAO_SALE = 'nhom-sale-9';
  delete process.env.AI_AGENT_THREAD_BAO_SALE_LOAI;
  xoaLichSuBao();
  vi.mocked(guiTin).mockClear().mockResolvedValue(undefined);
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  process.env = goc;
  vi.restoreAllMocks();
});

describe('baoNhanVien — gói ngữ cảnh đủ để nhân viên tiếp chuyện ngay', () => {
  it('gửi vào đúng thread env, KHÔNG giả nhịp người, đủ: khách, tin, lý do, hội thoại', async () => {
    const kq = await baoNhanVien(DICH, GOI);

    expect(kq).toBe(true);
    expect(guiTin).toHaveBeenCalledTimes(1);
    const [dichBao, noiDung, giaNguoi] = vi.mocked(guiTin).mock.calls[0]!;
    expect(dichBao.threadId).toBe('nhom-sale-9');
    expect(dichBao.threadType).toBe(1); // mặc định nhóm
    expect(dichBao.accountId).toBe('acc-1'); // gửi từ chính nick đang tiếp khách
    expect(giaNguoi).toBe(false);
    expect(noiDung).toContain('Anh Long · 0901234567');
    expect(noiDung).toContain('lấy anh 5 cuộn led 5m');
    expect(noiDung).toContain('Model trả câu rỗng');
    expect(noiDung).toContain('conv-1');
    expect(noiDung).toContain('2 lần');
  });

  it('AI_AGENT_THREAD_BAO_SALE_LOAI=0 → gửi chat 1-1', async () => {
    process.env.AI_AGENT_THREAD_BAO_SALE_LOAI = '0';

    await baoNhanVien(DICH, GOI);

    expect(vi.mocked(guiTin).mock.calls[0]![0].threadType).toBe(0);
  });

  it('throttle: cùng hội thoại trong 10 phút chỉ báo MỘT lần', async () => {
    expect(await baoNhanVien(DICH, GOI)).toBe(true);
    expect(await baoNhanVien(DICH, GOI)).toBe(false); // bí lần 2 → không dội lại
    expect(guiTin).toHaveBeenCalledTimes(1);
  });

  it('hội thoại KHÁC nhau không chặn nhau', async () => {
    expect(await baoNhanVien(DICH, GOI)).toBe(true);
    expect(await baoNhanVien(DICH, { ...GOI, conversationId: 'conv-2' })).toBe(true);
    expect(guiTin).toHaveBeenCalledTimes(2);
  });

  it('THIẾU env thread báo → vẫn trả true: khách vẫn PHẢI nhận câu giữ chân', async () => {
    // Thiếu cấu hình chỉ được lấy đi tin báo nhân viên, không được tái tạo
    // sự im lặng với khách — đó chính là bug gốc.
    delete process.env.AI_AGENT_THREAD_BAO_SALE;

    const kq = await baoNhanVien(DICH, GOI);

    expect(kq).toBe(true);
    expect(guiTin).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled(); // nhưng phải để lại dấu vết
  });

  it('gửi báo LỖI → nuốt, vẫn trả true — báo hỏng không được làm vỡ luồng trả khách', async () => {
    vi.mocked(guiTin).mockRejectedValueOnce(new Error('zalo sập'));

    await expect(baoNhanVien(DICH, GOI)).resolves.toBe(true);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('CAU_GIU_CHAN — hứa người, không hứa nội dung', () => {
  it('không chứa lời khoe đã làm gì (né hàng rào khoeDaLenDon)', () => {
    for (const cam of ['đã tạo đơn', 'đã lên đơn', 'đã đặt', 'đã chốt']) {
      expect(CAU_GIU_CHAN.toLowerCase()).not.toContain(cam);
    }
  });
});
