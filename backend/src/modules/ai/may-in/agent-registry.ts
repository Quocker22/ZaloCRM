// SPDX-License-Identifier: AGPL-3.0-or-later
// AgentRegistry — quản lý agent PC-cầu-nối (mỗi org 1 agent) đang giữ kết nối
// WebSocket sống, gửi job in cho agent và chờ agent báo kết quả theo jobId.
//
// VÌ SAO tách khỏi WS transport (agent-ws.ts, Task 3): registry chỉ biết
// "gửi message" qua một hàm `gui` bất kỳ (WS thật hay giả trong test đều
// dùng chung được) — không tự mở/đóng socket, không parse JSON WS ở đây.
//
// VÌ SAO reject khi agent huỷ đăng ký giữa lúc đang chờ (thay vì treo mãi):
// giống luật A3 ở ipp-client — mất kết nối giữa chừng thì KHÔNG BIẾT máy in
// đã nhận job chưa, hàng đợi phải biết để chuyển khong_ro chứ không được coi
// là "chưa gửi" (đó là lý do message chứa "agent rớt" chứ không phải "không
// có agent" — AgentClient ở Task 2 phân loại 2 câu này khác nhau).

export interface JobIn {
  id: string;
  pdfBase64: string;
  paperSize: string;
  tray: string;
  copies: number;
}

export interface KetQuaAgent {
  trangThai: 'da_in' | 'loi';
  loiCuoi?: string;
}

interface ChoKetQua {
  resolve: (kq: KetQuaAgent) => void;
  reject: (err: Error) => void;
}

interface AgentDangKy {
  gui: (msg: unknown) => void;
  cho: Map<string, ChoKetQua>;
}

export class AgentRegistry {
  private readonly agents = new Map<string, AgentDangKy>();

  /** Agent của org kết nối WS xong gọi hàm này. Trả về hàm huỷ đăng ký. */
  dangKy(orgId: string, gui: (msg: unknown) => void): () => void {
    const agent: AgentDangKy = { gui, cho: new Map() };
    this.agents.set(orgId, agent);
    return () => {
      // Chỉ tự huỷ đăng ký của chính mình — agent mới đăng ký lại (reconnect
      // nhanh) sau khi cái cũ huỷ không bị mất kết nối oan.
      if (this.agents.get(orgId) === agent) {
        this.agents.delete(orgId);
      }
      // Mọi job đang chờ agent này trả lời giờ KHÔNG THỂ biết máy in đã nhận
      // chưa → reject rõ ràng, không được để Promise treo mãi.
      for (const { reject } of agent.cho.values()) {
        reject(new Error(`agent rớt giữa chừng khi đang chờ kết quả (org ${orgId})`));
      }
      agent.cho.clear();
    };
  }

  coAgent(orgId: string): boolean {
    return this.agents.has(orgId);
  }

  /** Gửi job cho agent của org, resolve/reject khi agent báo qua nhanKetQua. */
  guiJob(orgId: string, job: JobIn): Promise<KetQuaAgent> {
    const agent = this.agents.get(orgId);
    if (!agent) {
      // Chưa gửi được gì — an toàn để hàng đợi retry (giống LoiIpp guiDuoc=false).
      return Promise.reject(new Error(`không có agent online cho org ${orgId}`));
    }
    return new Promise<KetQuaAgent>((resolve, reject) => {
      agent.cho.set(job.id, { resolve, reject });
      agent.gui({ loai: 'in', job });
    });
  }

  /** Agent gọi lại (qua WS message) khi in xong hoặc lỗi. */
  nhanKetQua(jobId: string, kq: KetQuaAgent): void {
    for (const agent of this.agents.values()) {
      const cho = agent.cho.get(jobId);
      if (cho) {
        agent.cho.delete(jobId);
        cho.resolve(kq);
        return;
      }
    }
  }
}
