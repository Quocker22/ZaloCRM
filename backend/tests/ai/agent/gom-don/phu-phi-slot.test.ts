// SPDX-License-Identifier: AGPL-3.0-or-later
// Slot PHỤ PHÍ (24/08) — lamSachTrich phải nhận phuPhi từ model (kể cả
// snake_case) và vứt số rác. Ca thật 23:08: "thêmm 70k ship" chưa có ô này.
import { describe, it, expect } from 'vitest';
import { lamSachTrich } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/trich-slot.js';

describe('lamSachTrich — phuPhi', () => {
  it('nhận phuPhi chuẩn', () => {
    const kq = lamSachTrich({ phuPhi: [{ ten: 'Phí vận chuyển', tien: 70000 }] });
    expect(kq.phuPhi).toEqual([{ ten: 'Phí vận chuyển', tien: 70000 }]);
  });
  it('nhận cả snake_case phu_phi (model hay đổi kiểu tên)', () => {
    const kq = lamSachTrich({ phu_phi: [{ ten: 'Phí lắp đặt', tien: 200000 }] });
    expect(kq.phuPhi).toEqual([{ ten: 'Phí lắp đặt', tien: 200000 }]);
  });
  it('tiền rác (0, âm, vượt trần) hay tên rỗng → bỏ, không có phuPhi', () => {
    const kq = lamSachTrich({ phuPhi: [{ ten: '', tien: 70000 }, { ten: 'Phí', tien: -5 }] });
    expect(kq.phuPhi).toBeUndefined();
  });
});
