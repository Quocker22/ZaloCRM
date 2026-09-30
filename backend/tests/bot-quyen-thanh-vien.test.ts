// SPDX-License-Identifier: AGPL-3.0-or-later
// Quyền bot (docs/77 §3.2) — bộ đọc thành viên nhóm từ Zalo, phần KHÔNG cần DB/mạng:
// tách uid từ memVerList, bộ đọc mặc định (zaloOps giả), và hạn giờ gọi Zalo.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getGroupInfo = vi.fn();
const getGroupMembersInfo = vi.fn();
vi.mock('../src/shared/zalo-operations.js', () => ({
  zaloOps: {
    getGroupInfo: (...a: unknown[]) => getGroupInfo(...a),
    getGroupMembersInfo: (...a: unknown[]) => getGroupMembersInfo(...a),
  },
}));

import {
  uidTuThongTinNhom, docThanhVienZaloMacDinh, hetGio, HET_GIO_ZALO_MS,
} from '../src/modules/bot-quyen/bot-quyen-thanh-vien.js';

describe('uidTuThongTinNhom — memVerList "uid_phienban" → uid', () => {
  it('lấy đúng nhóm theo id, bỏ hậu tố _ver, gộp trùng, bỏ rỗng', () => {
    const info = {
      gridInfoMap: {
        khac: { memVerList: ['x_1'] },
        g1: { memVerList: ['111_0', '222_5', '111_9', '', '_3', 333] },
      },
    };
    expect(uidTuThongTinNhom(info, 'g1')).toEqual(['111', '222', '333']);
  });

  it('không có khoá đúng id ⇒ lấy nhóm đầu tiên (như group-routes /members)', () => {
    expect(uidTuThongTinNhom({ gridInfoMap: { khac: { memVerList: ['9_1'] } } }, 'g1')).toEqual(['9']);
  });

  it('thiếu / sai hình ⇒ mảng rỗng, không nổ', () => {
    expect(uidTuThongTinNhom(null, 'g1')).toEqual([]);
    expect(uidTuThongTinNhom({}, 'g1')).toEqual([]);
    expect(uidTuThongTinNhom({ gridInfoMap: { g1: { memVerList: 'x' } } }, 'g1')).toEqual([]);
  });
});

describe('docThanhVienZaloMacDinh (zaloOps giả — không gọi mạng)', () => {
  beforeEach(() => { getGroupInfo.mockReset(); getGroupMembersInfo.mockReset(); });

  it('uid từ getGroupInfo, tên từ getGroupMembersInfo (displayName → zaloName → uid)', async () => {
    getGroupInfo.mockResolvedValue({ gridInfoMap: { g1: { memVerList: ['1_0', '2_0', '3_0'] } } });
    getGroupMembersInfo.mockResolvedValue({
      profiles: { 1: { id: '1', displayName: 'An' }, 2: { id: '2', zaloName: 'Bình Zalo' } },
    });
    const ds = await docThanhVienZaloMacDinh('nick-1', 'g1');
    expect(getGroupInfo).toHaveBeenCalledWith('nick-1', 'g1');
    expect(getGroupMembersInfo).toHaveBeenCalledWith('nick-1', ['1', '2', '3']);
    expect(ds).toEqual([
      { zaloUid: '1', ten: 'An' },
      { zaloUid: '2', ten: 'Bình Zalo' },
      { zaloUid: '3', ten: '3' },
    ]);
  });

  it('getGroupMembersInfo lỗi ⇒ vẫn đủ uid (tên = uid)', async () => {
    getGroupInfo.mockResolvedValue({ gridInfoMap: { g1: { memVerList: ['7_1'] } } });
    getGroupMembersInfo.mockRejectedValue(new Error('rate limited'));
    expect(await docThanhVienZaloMacDinh('nick-1', 'g1')).toEqual([{ zaloUid: '7', ten: '7' }]);
  });

  it('nhóm không có thành viên ⇒ [] và không gọi getGroupMembersInfo', async () => {
    getGroupInfo.mockResolvedValue({ gridInfoMap: { g1: { memVerList: [] } } });
    expect(await docThanhVienZaloMacDinh('nick-1', 'g1')).toEqual([]);
    expect(getGroupMembersInfo).not.toHaveBeenCalled();
  });

  it('getGroupInfo lỗi (nick chưa kết nối) ⇒ ném lỗi cho bên gọi rơi về nguồn khác', async () => {
    getGroupInfo.mockRejectedValue(new Error('Zalo account not connected'));
    await expect(docThanhVienZaloMacDinh('nick-1', 'g1')).rejects.toThrow('not connected');
  });
});

describe('hetGio — hạn giờ gọi Zalo', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('mặc định 10 giây', () => {
    expect(HET_GIO_ZALO_MS).toBe(10_000);
  });

  it('lời gọi không bao giờ trả ⇒ từ chối đúng lúc hết hạn, không sớm hơn', async () => {
    const treo = new Promise<string>(() => {});
    let ket: string | null = null;
    const p = hetGio(treo, HET_GIO_ZALO_MS).catch((e: Error) => { ket = e.message; });
    await vi.advanceTimersByTimeAsync(HET_GIO_ZALO_MS - 1);
    expect(ket).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(ket).toContain('không trả lời sau 10 giây');
  });

  it('trả kịp ⇒ giữ kết quả, huỷ hẹn giờ', async () => {
    const ok = hetGio(Promise.resolve('xong'), HET_GIO_ZALO_MS);
    await expect(ok).resolves.toBe('xong');
    expect(vi.getTimerCount()).toBe(0);
  });
});
