// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: giới hạn tin/khách — chặn cost-DoS TRƯỚC cổng LLM.
//
// Rủi ro gốc (bản đánh giá 05/08/2026): không giới hạn → một người spam 1.000
// tin đốt ~200k đ tiền LLM. Hợp đồng cốt lõi: tin bị chặn KHÔNG tốn một token
// nào, và bot chỉ xin phép đúng MỘT câu rồi im — không thành máy lặp.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  demVaKiemTra,
  xoaBoDem,
  maxTinGio,
  maxTinNgay,
  CAU_XIN_PHEP,
} from '../../../src/modules/ai/agent/noi-zalo/gioi-han.js';
import { logger } from '../../../src/shared/utils/logger.js';

const T0 = 1_800_000_000_000; // mốc bất kỳ, cố định để test tất định
const PHUT = 60_000;

let goc: NodeJS.ProcessEnv;
beforeEach(() => {
  goc = { ...process.env };
  delete process.env.AI_AGENT_MAX_TIN_GIO;
  delete process.env.AI_AGENT_MAX_TIN_NGAY;
  xoaBoDem();
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  process.env = goc;
  vi.restoreAllMocks();
});

describe('trần mặc định — đủ cho khách thật, chặn spam', () => {
  it('15 tin/giờ và 60 tin/ngày khi không đặt env', () => {
    expect(maxTinGio()).toBe(15);
    expect(maxTinNgay()).toBe(60);
  });

  it('env chỉnh được cả hai trần', () => {
    process.env.AI_AGENT_MAX_TIN_GIO = '3';
    process.env.AI_AGENT_MAX_TIN_NGAY = '10';
    expect(maxTinGio()).toBe(3);
    expect(maxTinNgay()).toBe(10);
  });
});

describe('trần giờ — cửa sổ trượt', () => {
  it('15 tin đầu cho qua, tin 16 chặn với lanDau=true, tin 17 lanDau=false', () => {
    for (let i = 0; i < 15; i++) {
      expect(demVaKiemTra('k1', T0 + i * PHUT)).toEqual({ cho: true });
    }
    expect(demVaKiemTra('k1', T0 + 15 * PHUT)).toEqual({
      cho: false, lyDo: 'qua_tran_gio', lanDau: true,
    });
    // Spam tiếp → vẫn chặn nhưng KHÔNG xin phép lại — bot không được lặp máy móc.
    expect(demVaKiemTra('k1', T0 + 16 * PHUT)).toMatchObject({ cho: false, lanDau: false });
  });

  it('tin cũ rơi khỏi cửa sổ 1 giờ → khách được nói tiếp', () => {
    for (let i = 0; i < 15; i++) demVaKiemTra('k1', T0 + i * PHUT);
    // 61 phút sau tin đầu: tin ở phút 0 đã rơi khỏi cửa sổ giờ.
    expect(demVaKiemTra('k1', T0 + 61 * PHUT)).toEqual({ cho: true });
  });

  it('tin BỊ CHẶN vẫn bị đếm — spam trong lúc chặn không giúp cửa sổ trôi nhanh hơn', () => {
    process.env.AI_AGENT_MAX_TIN_GIO = '2';
    demVaKiemTra('k1', T0);
    demVaKiemTra('k1', T0 + 1 * PHUT);
    demVaKiemTra('k1', T0 + 30 * PHUT); // chặn, nhưng ĐƯỢC đếm
    // Phút 62: hai tin đầu đã rơi, nhưng tin phút 30 còn trong cửa sổ → mới 1 tin.
    expect(demVaKiemTra('k1', T0 + 62 * PHUT)).toEqual({ cho: true });
    // Và giờ có 2 tin trong cửa sổ (phút 30, 62) → tin kế bị chặn.
    expect(demVaKiemTra('k1', T0 + 63 * PHUT)).toMatchObject({ cho: false });
  });
});

describe('trần ngày', () => {
  it('rải đều dưới trần giờ vẫn chạm trần ngày, lanDau=true đúng một lần', () => {
    process.env.AI_AGENT_MAX_TIN_GIO = '5';
    process.env.AI_AGENT_MAX_TIN_NGAY = '8';
    // 8 tin, mỗi tin cách nhau 2 giờ → không bao giờ quá 5 tin/giờ.
    for (let i = 0; i < 8; i++) {
      expect(demVaKiemTra('k1', T0 + i * 120 * PHUT).cho).toBe(true);
    }
    expect(demVaKiemTra('k1', T0 + 8 * 120 * PHUT)).toEqual({
      cho: false, lyDo: 'qua_tran_ngay', lanDau: true,
    });
    expect(demVaKiemTra('k1', T0 + 8 * 120 * PHUT + 1)).toMatchObject({
      cho: false, lyDo: 'qua_tran_ngay', lanDau: false,
    });
  });
});

describe('cách ly theo khoá', () => {
  it('khách này spam không khoá mồm khách kia', () => {
    process.env.AI_AGENT_MAX_TIN_GIO = '1';
    demVaKiemTra('spammer', T0);
    expect(demVaKiemTra('spammer', T0 + 1).cho).toBe(false);
    expect(demVaKiemTra('khach-that', T0 + 2).cho).toBe(true);
  });
});

describe('CAU_XIN_PHEP — không hứa nội dung', () => {
  it('không chứa lời khoe đã làm gì', () => {
    for (const cam of ['đã tạo đơn', 'đã lên đơn', 'đã đặt', 'đã chốt']) {
      expect(CAU_XIN_PHEP.toLowerCase()).not.toContain(cam);
    }
  });
});
