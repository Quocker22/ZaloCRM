// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: công tắc bật/tắt luồng agent trên Zalo thật.
//
// Trọng tâm: MẶC ĐỊNH PHẢI TẮT. Module này quyết định khách nhận câu trả lời của
// agent mới hay của luồng RAG cũ — bật nhầm là khách thật hứng lỗi thật. Bật
// phải là hành động có chủ đích, không phải hiệu ứng phụ của một lần deploy.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { batLuongNhanVien, batLuongKhach, duCauHinh } from '../../../src/modules/ai/agent/noi-zalo.js';

const DU = {
  ODOO_URL: 'http://localhost:8069', ODOO_DB: 'nelia_prod',
  ODOO_USERNAME: 'bot_zalo', ODOO_PASSWORD: 'x',
  LLM_BASE: 'http://x/v1', LLM_KEY: 'k', LLM_MODEL: 'm',
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

describe('duCauHinh — thiếu cấu hình thì nhường luồng cũ', () => {
  it('đủ 7 biến → true', () => {
    expect(duCauHinh(DU)).toBe(true);
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
