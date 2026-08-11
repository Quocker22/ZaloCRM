// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: baoNhanVien gửi tới DANH SÁCH đích lấy từ DB, không còn một
// env cứng. Bổ sung cho bao-nhan-vien.func.ts (test đường env cũ vẫn chạy).
//
// Khoá hợp đồng: một lần bí → mỗi đích nhận ĐÚNG một tin; một đích hỏng không
// được nuốt tin của đích còn lại; thiếu orgId thì vẫn rơi về env.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/modules/ai/agent/noi-zalo/gui-zalo.js', () => ({
  guiTin: vi.fn(async () => {}),
}));

const layDichBao = vi.fn();
vi.mock('../../../src/modules/ai/agent/noi-zalo/dich-bao.js', async (goc) => ({
  ...(await goc<Record<string, unknown>>()),
  layDichBao: (...a: unknown[]) => layDichBao(...a),
}));

import { guiTin } from '../../../src/modules/ai/agent/noi-zalo/gui-zalo.js';
import type { DichGui } from '../../../src/modules/ai/agent/noi-zalo/gui-zalo.js';
import { baoNhanVien, xoaLichSuBao, type GoiNguCanh } from '../../../src/modules/ai/agent/noi-zalo/bao-nhan-vien.js';
import { LOAI_VIEC } from '../../../src/modules/ai/agent/noi-zalo/dich-bao.js';
import { logger } from '../../../src/shared/utils/logger.js';

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

beforeEach(() => {
  xoaLichSuBao();
  vi.mocked(guiTin).mockClear().mockResolvedValue(undefined);
  layDichBao.mockReset().mockResolvedValue([]);
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('baoNhanVien — gửi tới NHIỀU đích cấu hình trong DB', () => {
  it('hai đích bật → mỗi đích nhận đúng một tin, đúng threadType', async () => {
    layDichBao.mockResolvedValue([
      { threadId: 'nhom-truc-khach', threadType: 1, tenGoi: 'Nhóm trực khách' },
      { threadId: 'nick-anh-quoc', threadType: 0, tenGoi: 'Anh Quốc' },
    ]);

    const kq = await baoNhanVien(DICH, { ...GOI, orgId: 'org-1' });

    expect(kq).toBe(true);
    expect(guiTin).toHaveBeenCalledTimes(2);
    const goi = vi.mocked(guiTin).mock.calls.map((c) => c[0]);
    expect(goi[0]!.threadId).toBe('nhom-truc-khach');
    expect(goi[0]!.threadType).toBe(1);
    expect(goi[1]!.threadId).toBe('nick-anh-quoc');
    expect(goi[1]!.threadType).toBe(0);
    // Gửi từ chính nick đang tiếp khách — nhân viên thấy ngay nick nào kẹt.
    expect(goi.every((g) => g!.accountId === 'acc-1')).toBe(true);
  });

  it('gửi đích thứ nhất LỖI → đích thứ hai vẫn nhận được tin', async () => {
    layDichBao.mockResolvedValue([
      { threadId: 'nhom-hong', threadType: 1, tenGoi: 'Nhóm hỏng' },
      { threadId: 'nick-quoc', threadType: 0, tenGoi: 'Anh Quốc' },
    ]);
    vi.mocked(guiTin).mockRejectedValueOnce(new Error('zalo sập'));

    await expect(baoNhanVien(DICH, { ...GOI, orgId: 'org-1' })).resolves.toBe(true);

    expect(guiTin).toHaveBeenCalledTimes(2);
    expect(vi.mocked(guiTin).mock.calls[1]![0].threadId).toBe('nick-quoc');
    expect(logger.error).toHaveBeenCalled();
  });

  it('KHÔNG có đích nào → vẫn trả true: khách vẫn PHẢI nhận câu giữ chân', async () => {
    layDichBao.mockResolvedValue([]);

    const kq = await baoNhanVien(DICH, { ...GOI, orgId: 'org-1' });

    expect(kq).toBe(true);
    expect(guiTin).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled(); // phải để lại dấu vết
  });

  it('nội dung tin giữ nguyên gói ngữ cảnh: khách, tin, lý do, hội thoại', async () => {
    layDichBao.mockResolvedValue([{ threadId: 't1', threadType: 1, tenGoi: 'Nhóm' }]);

    await baoNhanVien(DICH, { ...GOI, orgId: 'org-1' });

    const noiDung = vi.mocked(guiTin).mock.calls[0]![1];
    expect(noiDung).toContain('Anh Long · 0901234567');
    expect(noiDung).toContain('lấy anh 5 cuộn led 5m');
    expect(noiDung).toContain('Model trả câu rỗng');
    expect(noiDung).toContain('conv-1');
  });
});

describe('baoNhanVien — chọn ĐÚNG loại việc để lọc đích', () => {
  it('mặc định là "khách cần hỗ trợ"', async () => {
    layDichBao.mockResolvedValue([{ threadId: 't1', threadType: 1, tenGoi: 'N' }]);

    await baoNhanVien(DICH, { ...GOI, orgId: 'org-1' });

    expect(layDichBao).toHaveBeenCalledWith('org-1', LOAI_VIEC.KHACH_CAN_HO_TRO);
  });

  it('gọi với loaiViec=bot_su_co → lọc theo đích nhận sự cố', async () => {
    layDichBao.mockResolvedValue([{ threadId: 't1', threadType: 1, tenGoi: 'N' }]);

    await baoNhanVien(DICH, { ...GOI, orgId: 'org-1', loaiViec: LOAI_VIEC.BOT_SU_CO });

    expect(layDichBao).toHaveBeenCalledWith('org-1', LOAI_VIEC.BOT_SU_CO);
  });

  it('THIẾU orgId (caller cũ chưa truyền) → vẫn chạy, dùng đường env', async () => {
    // Tương thích ngược ở tầng gọi: không có orgId thì layDichBao nhận '' và
    // trả về đích env — không được ném, không được im lặng thêm ca nào.
    layDichBao.mockResolvedValue([{ threadId: 'env-thread', threadType: 1, tenGoi: 'env' }]);

    const kq = await baoNhanVien(DICH, GOI);

    expect(kq).toBe(true);
    expect(guiTin).toHaveBeenCalledTimes(1);
  });
});

describe('throttle vẫn giữ nguyên khi có nhiều đích', () => {
  it('bí hai lần trong 10 phút → chỉ MỘT vòng gửi cho tất cả đích', async () => {
    layDichBao.mockResolvedValue([
      { threadId: 't1', threadType: 1, tenGoi: 'A' },
      { threadId: 't2', threadType: 1, tenGoi: 'B' },
    ]);

    expect(await baoNhanVien(DICH, { ...GOI, orgId: 'org-1' })).toBe(true);
    expect(await baoNhanVien(DICH, { ...GOI, orgId: 'org-1' })).toBe(false);

    expect(guiTin).toHaveBeenCalledTimes(2); // 2 đích × 1 vòng, không phải 4
  });
});
