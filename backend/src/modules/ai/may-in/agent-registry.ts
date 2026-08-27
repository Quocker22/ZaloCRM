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
// là "chưa gửi".
//
// VÌ SAO 2 class lỗi riêng thay vì phân biệt bằng message string: fix round 1
// (review) — AgentClient trước đây regex-match substring của Error.message để
// phân loại. Message đổi chữ (refactor, dịch lại câu) sẽ âm thầm rơi vào
// catch-all LoiIpp(guiDuoc=true) — SAI HƯỚNG AN TOÀN, biến lỗi "không biết gì"
// thành "retry được". Dùng `instanceof` để trình biên dịch + runtime đều ép
// đúng, không phụ thuộc câu chữ.

/** Chưa có agent online cho org — CHẮC CHẮN chưa gửi được gì, retry an toàn. */
export class AgentKhongOnline extends Error {
  constructor(orgId: string) {
    super(`không có agent online cho org ${orgId}`);
    this.name = 'AgentKhongOnline';
  }
}

/** Agent ngắt kết nối GIỮA LÚC đang chờ trả lời — không biết job đã tới máy in chưa. */
export class AgentRotGiuaChung extends Error {
  constructor(orgId: string) {
    super(`agent rớt giữa chừng khi đang chờ kết quả (org ${orgId})`);
    this.name = 'AgentRotGiuaChung';
  }
}

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
        reject(new AgentRotGiuaChung(orgId));
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
      return Promise.reject(new AgentKhongOnline(orgId));
    }
    return new Promise<KetQuaAgent>((resolve, reject) => {
      agent.cho.set(job.id, { resolve, reject });
      agent.gui({ loai: 'in', job });
    });
  }

  /**
   * Agent gọi lại (qua WS message) khi in xong hoặc lỗi. Nhận orgId thay vì
   * quét mọi agent: fix round 1 (review) — job.id chỉ unique THEO QUY ƯỚC
   * (prefix orgId ở AgentClient), không phải bất biến của registry. Quét
   * `agents.values()` tìm jobId trùng có thể resolve NHẦM job của org khác
   * nếu 2 org tình cờ sinh cùng id. WS layer (Task 3) luôn biết orgId của
   * socket đang gửi kết quả nên truyền được, không mất khả năng gì.
   */
  nhanKetQua(orgId: string, jobId: string, kq: KetQuaAgent): void {
    const agent = this.agents.get(orgId);
    const cho = agent?.cho.get(jobId);
    if (cho) {
      agent!.cho.delete(jobId);
      cho.resolve(kq);
    }
  }
}
