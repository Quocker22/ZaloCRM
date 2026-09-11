// SPDX-License-Identifier: AGPL-3.0-or-later
// AgentRegistry — quản lý agent PC-cầu-nối (máy in) đang giữ kết nối
// WebSocket sống, gửi job in cho agent và chờ agent báo kết quả theo jobId.
//
// Task 4 (10/09, nhiều chi nhánh): key đổi từ orgId sang TOKEN của máy in.
// Trước đây "1 org 1 agent" nên orgId đủ làm khoá; giờ 1 org có thể có
// NHIỀU máy in (nhiều chi nhánh) sống song song, mỗi máy khai 1 token riêng
// (bảng print_agents, Task 1) — token mới là danh tính duy nhất của 1 agent,
// orgId không còn phân biệt được máy nào trong nhiều máy của cùng 1 org.
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
// catch-all LoiIpp(guiDuoc=true), tức coi lỗi mơ hồ là "retry được".
// Dùng `instanceof` để trình biên dịch + runtime đều ép đúng, không phụ
// thuộc câu chữ.

/** Chưa có agent online cho token này — CHẮC CHẮN chưa gửi được gì, retry an toàn. */
export class AgentKhongOnline extends Error {
  constructor(token: string) {
    super(`không có agent online cho token ${token}`);
    this.name = 'AgentKhongOnline';
  }
}

/** Agent ngắt kết nối GIỮA LÚC đang chờ trả lời — không biết job đã tới máy in chưa. */
export class AgentRotGiuaChung extends Error {
  constructor(token: string) {
    super(`agent rớt giữa chừng khi đang chờ kết quả (token ${token})`);
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

  /** Agent của token này kết nối WS xong gọi hàm này. Trả về hàm huỷ đăng ký. */
  dangKy(token: string, gui: (msg: unknown) => void): () => void {
    const agent: AgentDangKy = { gui, cho: new Map() };
    this.agents.set(token, agent);
    return () => {
      // Chỉ tự huỷ đăng ký của chính mình — agent mới đăng ký lại (reconnect
      // nhanh) sau khi cái cũ huỷ không bị mất kết nối oan.
      if (this.agents.get(token) === agent) {
        this.agents.delete(token);
      }
      // Mọi job đang chờ agent này trả lời giờ KHÔNG THỂ biết máy in đã nhận
      // chưa → reject rõ ràng, không được để Promise treo mãi.
      for (const { reject } of agent.cho.values()) {
        reject(new AgentRotGiuaChung(token));
      }
      agent.cho.clear();
    };
  }

  coAgent(token: string): boolean {
    return this.agents.has(token);
  }

  /** Gửi job cho agent của token này, resolve/reject khi agent báo qua nhanKetQua. */
  guiJob(token: string, job: JobIn): Promise<KetQuaAgent> {
    const agent = this.agents.get(token);
    if (!agent) {
      // Chưa gửi được gì — an toàn để hàng đợi retry (giống LoiIpp guiDuoc=false).
      return Promise.reject(new AgentKhongOnline(token));
    }
    return new Promise<KetQuaAgent>((resolve, reject) => {
      agent.cho.set(job.id, { resolve, reject });
      agent.gui({ loai: 'in', job });
    });
  }

  /**
   * Agent gọi lại (qua WS message) khi in xong hoặc lỗi. Nhận token thay vì
   * quét mọi agent: fix round 1 (review) — job.id chỉ unique THEO QUY ƯỚC
   * (prefix token ở AgentClient), không phải bất biến của registry. Quét
   * `agents.values()` tìm jobId trùng có thể resolve NHẦM job của agent khác
   * nếu 2 agent tình cờ sinh cùng id. WS layer (Task 3+4) luôn biết token của
   * socket đang gửi kết quả nên truyền được, không mất khả năng gì.
   */
  nhanKetQua(token: string, jobId: string, kq: KetQuaAgent): void {
    const agent = this.agents.get(token);
    const cho = agent?.cho.get(jobId);
    if (cho) {
      agent!.cho.delete(jobId);
      cho.resolve(kq);
    }
  }
}

/**
 * Singleton dùng chung toàn tiến trình — MỘT registry duy nhất phải giữ mọi
 * agent online, vì cron (Task 5, đọc hàng đợi print_jobs rồi gọi guiJob) và
 * WS handler (Task 3+4, agent-ws.ts, gọi dangKy khi agent connect) PHẢI thấy
 * chung một Map agents. Hai instance riêng sẽ khiến cron luôn thấy
 * coAgent=false dù agent đã kết nối ở phía WS.
 *
 * Test không dùng singleton này — mỗi test tự `new AgentRegistry()` để cô
 * lập trạng thái giữa các case (xem agent-ws.func.ts, agent-client.func.ts).
 */
export const agentRegistry = new AgentRegistry();
