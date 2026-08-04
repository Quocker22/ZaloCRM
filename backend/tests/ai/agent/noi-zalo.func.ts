// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: công tắc bật/tắt luồng agent trên Zalo thật.
//
// Trọng tâm: MẶC ĐỊNH PHẢI TẮT. Module này quyết định khách nhận câu trả lời của
// agent mới hay của luồng RAG cũ — bật nhầm là khách thật hứng lỗi thật. Bật
// phải là hành động có chủ đích, không phải hiệu ứng phụ của một lần deploy.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { batLuongNhanVien, batLuongKhach, duCauHinh, seqTuMessageId, batKhachTuChotDon, duongDanChat } from '../../../src/modules/ai/agent/noi-zalo.js';
import { sinhKhoaDon, tachKhoaDon } from '../../../src/modules/ai/odoo/idempotency.js';

const DU = {
  ODOO_URL: 'http://localhost:8069', ODOO_DB: 'nelia_prod',
  ODOO_USERNAME: 'bot_zalo', ODOO_PASSWORD: 'x',
} as NodeJS.ProcessEnv;

let goc: NodeJS.ProcessEnv;
beforeEach(() => { goc = { ...process.env }; });
afterEach(() => { process.env = goc; });

describe('Công tắc — mặc định TẮT', () => {
  it('KHÔNG đặt biến → cả hai luồng TẮT', () => {
    delete process.env.AI_AGENT_NHANVIEN;
    delete process.env.AI_AGENT_KHACH;

    expect(batLuongNhanVien()).toBe(false);
    expect(batLuongKhach()).toBe(false);
  });

  it('chỉ "1" mới bật — "true"/"yes"/"0" đều KHÔNG', () => {
    for (const v of ['true', 'yes', 'on', '0', '', 'TRUE']) {
      process.env.AI_AGENT_KHACH = v;
      expect(batLuongKhach(), `giá trị ${JSON.stringify(v)} không được bật`).toBe(false);
    }
    process.env.AI_AGENT_KHACH = '1';
    expect(batLuongKhach()).toBe(true);
  });

  it('hai công tắc ĐỘC LẬP — bật nhân viên KHÔNG kéo theo khách', () => {
    // Đây là cách anh thử an toàn: nhân viên trước, khách sau.
    process.env.AI_AGENT_NHANVIEN = '1';
    delete process.env.AI_AGENT_KHACH;

    expect(batLuongNhanVien()).toBe(true);
    expect(batLuongKhach()).toBe(false);
  });
});

describe('duCauHinh — thiếu Odoo thì nhường luồng cũ', () => {
  it('đủ 4 biến Odoo → true', () => {
    expect(duCauHinh(DU)).toBe(true);
  });

  it('KHÔNG đòi LLM_* — key/model lấy từ DB per-org, cùng nguồn luồng RAG cũ', () => {
    // Đòi thêm LLM_* thì agent có thể chạy model KHÁC luồng cũ mà không ai biết.
    expect(duCauHinh({ ...DU, LLM_BASE: undefined, LLM_KEY: undefined })).toBe(true);
  });

  it.each(Object.keys(DU))('thiếu %s → false', (k) => {
    const thieu = { ...DU };
    delete thieu[k];
    expect(duCauHinh(thieu)).toBe(false);
  });

  it('biến rỗng cũng tính là thiếu (khỏi gọi Odoo với url rỗng)', () => {
    expect(duCauHinh({ ...DU, ODOO_URL: '' })).toBe(false);
  });

  it('môi trường trống → false', () => {
    expect(duCauHinh({})).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('seqTuMessageId — khoá chống trùng đơn', () => {
  // Khoá đơn là `zalo:{conversationId}:{seq}` và nguyên tắc của nó là "retry
  // phải sinh RA CÙNG một khoá". Trước đây `seq` là SỐ ĐẾM log tool — nhân viên
  // gõ lại cùng lệnh (tưởng chưa nhận) là số đếm đã tăng → khoá khác → HAI ĐƠN.
  it('cùng messageId → CÙNG seq, kể cả gọi lại nhiều lần', () => {
    const id = 'clx8f3k2h0001abcd';
    expect(seqTuMessageId(id)).toBe(seqTuMessageId(id));
    expect(seqTuMessageId(id)).toBe(seqTuMessageId(id));
  });

  it('messageId khác → seq khác (lệnh thứ hai THẬT vẫn tạo được đơn thứ hai)', () => {
    expect(seqTuMessageId('clx8f3k2h0001abcd')).not.toBe(seqTuMessageId('clx8f3k2h0002abcd'));
  });

  it('luôn là số nguyên KHÔNG âm — sinhKhoaDon ép seq âm về 0, mất tính duy nhất', () => {
    for (const id of ['a', 'z'.repeat(50), 'clx8f3k2h0001abcd', '123', '@#$%']) {
      const n = seqTuMessageId(id);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
    }
  });

  it('khoá sinh ra tách ngược được và vừa giới hạn client_order_ref', () => {
    const khoa = sinhKhoaDon('conv-abc', seqTuMessageId('clx8f3k2h0001abcd'));

    expect(tachKhoaDon(khoa)?.conversationId).toBe('conv-abc');
    expect(khoa.length).toBeLessThan(255);
  });

  it('chuỗi rỗng không ném (tin lỗi vẫn phải có khoá)', () => {
    expect(() => seqTuMessageId('')).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Công tắc khách TỰ CHỐT ĐƠN — mặc định TẮT', () => {
  // Bật công tắc này = khách điều khiển được việc GHI vào Odoo qua câu chữ.
  // Phải là hành động có chủ đích, tách RIÊNG khỏi AI_AGENT_KHACH (chỉ tư vấn).
  it('KHÔNG đặt biến → TẮT', () => {
    delete process.env.AI_AGENT_KHACH_TU_CHOT;
    expect(batKhachTuChotDon()).toBe(false);
  });

  it('chỉ "1" mới bật', () => {
    for (const v of ['true', 'yes', '0', '']) {
      process.env.AI_AGENT_KHACH_TU_CHOT = v;
      expect(batKhachTuChotDon(), `"${v}" không được bật`).toBe(false);
    }
    process.env.AI_AGENT_KHACH_TU_CHOT = '1';
    expect(batKhachTuChotDon()).toBe(true);
  });

  it('ĐỘC LẬP với AI_AGENT_KHACH — bật tư vấn KHÔNG kéo theo quyền ghi', () => {
    process.env.AI_AGENT_KHACH = '1';
    delete process.env.AI_AGENT_KHACH_TU_CHOT;

    expect(batLuongKhach()).toBe(true);
    expect(batKhachTuChotDon()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Đường dẫn LLM phải khớp ai-service (luồng RAG cũ)', () => {
  // Bug thật 2026-08-04: ghép `${baseUrl}/chat/completions` (thiếu `/v1`) nên
  // 9Router trả HTML 404 và MỌI lượt agent khách rơi về luồng RAG cũ. Log chỉ
  // hiện "lỗi luồng khách" nên nhìn bên ngoài tưởng agent chưa bật.
  //
  // Đo thật trên 9Router:
  //   /chat/completions    → HTML 404 (đường dẫn không tồn tại)
  //   /v1/chat/completions → JSON "No active credentials" (đúng đường dẫn)
  it('openai → /v1/chat/completions', () => {
    expect(duongDanChat('openai', 'https://ai.byhung.com'))
      .toBe('https://ai.byhung.com/v1/chat/completions');
  });

  it('qwen → /compatible-mode/v1/... (khác các provider khác)', () => {
    expect(duongDanChat('qwen', 'https://x.com'))
      .toBe('https://x.com/compatible-mode/v1/chat/completions');
  });

  it('bỏ dấu / thừa cuối baseUrl — không sinh //v1', () => {
    expect(duongDanChat('openai', 'https://x.com/')).toBe('https://x.com/v1/chat/completions');
    expect(duongDanChat('openai', 'https://x.com///')).toBe('https://x.com/v1/chat/completions');
  });
});
