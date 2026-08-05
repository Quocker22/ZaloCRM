// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: hạn giờ cả lượt — hàng rào chống TREO im lặng.
//
// Bug gốc (2026-08-05, lần hai): nhân viên nhắn "chào ní", log ghi đúng một
// dòng "[agent/nv] BẮT ĐẦU xử lý" rồi im vĩnh viễn — không lỗi, không XONG.
// Thủ phạm: `fetch` không timeout trong embedding (EMBED_BASE_URL trỏ vào
// localhost:11434 không tồn tại).
//
// `taoDung` diệt được cổng im lặng ở các nhánh `return`, nhưng KHÔNG phủ được
// code treo giữa chừng. Đây là lớp phủ nốt: quá hạn thì PHẢI ném.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chayCoHanGio, hanGioLuot } from '../../../src/modules/ai/agent/noi-zalo/dung.js';
import { logger } from '../../../src/shared/utils/logger.js';

let goc: NodeJS.ProcessEnv;
beforeEach(() => {
  goc = { ...process.env };
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  process.env = goc;
  vi.restoreAllMocks();
});

describe('hanGioLuot — trần thời gian một lượt', () => {
  it('mặc định 90s: lượt thường 3-15s, quá 90s là hỏng chứ không phải chậm', () => {
    delete process.env.AI_AGENT_HAN_GIO_MS;
    expect(hanGioLuot()).toBe(90_000);
  });

  it('env chỉnh được (model local chậm)', () => {
    process.env.AI_AGENT_HAN_GIO_MS = '5000';
    expect(hanGioLuot()).toBe(5000);
  });
});

describe('chayCoHanGio — việc treo KHÔNG được im lặng', () => {
  it('việc xong trước hạn → trả kết quả bình thường', async () => {
    const kq = await chayCoHanGio('nv', Promise.resolve('xong'), 1000);

    expect(kq).toBe('xong');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('việc TREO vĩnh viễn → ném "quá hạn" + ghi log ERROR (đây là bug gốc)', async () => {
    // Promise không bao giờ resolve — mô phỏng đúng fetch không timeout.
    const treoMaiMai = new Promise<string>(() => {});

    await expect(chayCoHanGio('nv', treoMaiMai, 30)).rejects.toThrow(/quá hạn/);
    expect(logger.error).toHaveBeenCalledWith(
      { ms: 30 },
      expect.stringContaining('QUÁ HẠN'),
    );
  });

  it('việc ném lỗi thật → giữ nguyên lỗi đó, không nuốt thành lỗi hạn giờ', async () => {
    await expect(
      chayCoHanGio('khach', Promise.reject(new Error('Odoo sập')), 1000),
    ).rejects.toThrow('Odoo sập');
  });

  it('prefix log theo đúng luồng — grep một mẫu ra cả hai', async () => {
    await expect(chayCoHanGio('khach', new Promise(() => {}), 20)).rejects.toThrow();

    expect(logger.error).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('[agent/khach]'),
    );
  });
});
