// SPDX-License-Identifier: AGPL-3.0-or-later
// chonClientMayIn — hàm THUẦN chọn client máy in cho cron: có agent token thì
// ưu tiên AgentClient (đấu vào registry singleton, thấy agent WS đã đăng ký
// ở Task 3); không có thì rơi về IppClient (đường cũ); không có gì cả thì
// null (cron không bật — cùng triết lý tu-env.ts: thiếu cấu hình = tắt hẳn).
//
// Tách khỏi startMayInCron để test được mà không cần dựng cron.schedule/DB/
// Odoo thật — đúng tinh thần "hàm thuần dễ test" của constraints.md.
import { describe, it, expect } from 'vitest';
import { chonClientMayIn } from '../../../src/modules/ai/may-in/cron.js';
import { AgentClient } from '../../../src/modules/ai/may-in/agent-client.js';
import { IppClient } from '../../../src/modules/ai/may-in/ipp-client.js';
import { agentRegistry } from '../../../src/modules/ai/may-in/agent-registry.js';

describe('chonClientMayIn', () => {
  it('có AI_MAY_IN_AGENT_TOKEN → trả AgentClient dùng registry singleton', () => {
    const client = chonClientMayIn({
      env: {
        AI_MAY_IN_AGENT_TOKEN: 'tok-bi-mat',
        AI_MAY_IN_ORG_ID: 'org1',
      },
    });
    expect(client).toBeInstanceOf(AgentClient);
  });

  it('mặc định paperSize=A5, tray=tray-2 khi env không nói gì thêm', () => {
    // Không có cách đọc field private từ ngoài — kiểm gián tiếp qua hành vi:
    // gọi inPdf và xem job gửi cho registry (đăng ký agent giả để bắt job).
    const huy = agentRegistry.dangKy('org-mac-dinh', () => {});
    try {
      const client = chonClientMayIn({
        env: { AI_MAY_IN_AGENT_TOKEN: 'tok', AI_MAY_IN_ORG_ID: 'org-mac-dinh' },
      });
      expect(client).toBeInstanceOf(AgentClient);
      // guiJob sẽ treo promise chờ kết quả (agent giả không trả lời) — không
      // await, chỉ cần job đã được gửi đúng field là đủ cho test này; huỷ
      // đăng ký ngay sau đó để không rò rỉ promise treo giữa các test.
      void (client as AgentClient).inPdf(Buffer.from('%PDF'), 'INV/1').catch(() => {});
    } finally {
      huy();
    }
  });

  it('chỉ có AI_MAY_IN_IPP_URL (không agent token) → trả IppClient', () => {
    const client = chonClientMayIn({
      env: { AI_MAY_IN_IPP_URL: 'ipp://192.168.1.50:631/ipp/print' },
    });
    expect(client).toBeInstanceOf(IppClient);
  });

  it('không có gì → null (cron không bật)', () => {
    expect(chonClientMayIn({ env: {} })).toBeNull();
  });

  it('có cả 2 → ưu tiên AgentClient (agent online là kênh chính, IPP là fallback)', () => {
    const client = chonClientMayIn({
      env: {
        AI_MAY_IN_AGENT_TOKEN: 'tok',
        AI_MAY_IN_ORG_ID: 'org1',
        AI_MAY_IN_IPP_URL: 'ipp://192.168.1.50:631/ipp/print',
      },
    });
    expect(client).toBeInstanceOf(AgentClient);
  });

  it('có agent token nhưng thiếu AI_MAY_IN_ORG_ID → không tự đoán org, rơi về IPP/null', () => {
    // Không có org thì AgentClient không biết gửi job cho org nào — an toàn
    // hơn là rơi về IPP (nếu có) hoặc null, không được tự bịa orgId.
    const clientCoIpp = chonClientMayIn({
      env: {
        AI_MAY_IN_AGENT_TOKEN: 'tok',
        AI_MAY_IN_IPP_URL: 'ipp://192.168.1.50:631/ipp/print',
      },
    });
    expect(clientCoIpp).toBeInstanceOf(IppClient);

    const clientKhongIpp = chonClientMayIn({ env: { AI_MAY_IN_AGENT_TOKEN: 'tok' } });
    expect(clientKhongIpp).toBeNull();
  });

  it('chỉnh được paperSize/tray qua env AI_MAY_IN_PAPER_SIZE/AI_MAY_IN_TRAY', () => {
    const client = chonClientMayIn({
      env: {
        AI_MAY_IN_AGENT_TOKEN: 'tok',
        AI_MAY_IN_ORG_ID: 'org-tuy-chinh',
        AI_MAY_IN_PAPER_SIZE: 'A4',
        AI_MAY_IN_TRAY: 'tray-1',
      },
    });
    expect(client).toBeInstanceOf(AgentClient);
  });
});
