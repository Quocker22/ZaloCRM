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

/** 4 ký tự cuối của token — đủ để người trực phân biệt máy, không đủ để mạo danh.
 * Thông điệp lỗi đi vào print_jobs.loi_cuoi và nhật ký — CẤM chứa token đầy đủ. */
export function duoiToken(token: string): string {
  return `…${token.slice(-4)}`;
}

/** Chưa có agent online cho token này — CHẮC CHẮN chưa gửi được gì, retry an toàn. */
export class AgentKhongOnline extends Error {
  constructor(token: string) {
    super(`không có agent online cho token ${duoiToken(token)}`);
    this.name = 'AgentKhongOnline';
  }
}

/** Agent ngắt kết nối GIỮA LÚC đang chờ trả lời — không biết job đã tới máy in chưa. */
export class AgentRotGiuaChung extends Error {
  constructor(token: string) {
    super(`agent rớt giữa chừng khi đang chờ kết quả (token ${duoiToken(token)})`);
    this.name = 'AgentRotGiuaChung';
  }
}

/**
 * Agent KHÔNG trả lời trong hạn chờ (lỗi 13.1, MAY-IN-HANDOFF): trước đây
 * Promise treo mãi → cron giữ khoá `dangChay` → CẢ HỆ THỐNG IN DỪNG, kéo theo
 * mọi chi nhánh (đã xảy ra 18/09 và 3 lần ngày 24/09 — máy hết giấy, app im
 * lặng chống in đôi). Giờ hết hạn thì reject lỗi này: AgentClient đổi sang
 * LoiKhongRo → job `khong_ro` (KHÔNG retry, máy có thể đã nhận), cron chạy tiếp.
 */
export class AgentHetGioCho extends Error {
  constructor(token: string, readonly msCho: number) {
    super(`app máy in ${duoiToken(token)} không trả lời sau ${Math.round(msCho / 1000)} giây`);
    this.name = 'AgentHetGioCho';
  }
}

export interface JobIn {
  id: string;
  /**
   * Tên file PDF app PC dùng khi in: "AI-INV_2026_030045-<Ten_Khach>-<id>.pdf"
   * (ten-file-in.ts). Luôn CHỨA `id` — app nhận ra job trong hàng đợi in
   * Windows theo id đó. App bản cũ không đọc field này thì tự đặt tên như trước.
   */
  name: string;
  pdfBase64: string;
  paperSize: string;
  tray: string;
  copies: number;
}

export interface KetQuaAgent {
  /**
   * 'khong_ro' (24/09): app đã gửi máy in nhưng không xác nhận được — app CHỈ
   * gửi khi backend quảng bá hỗ trợ qua event `cau-hinh` (hợp đồng §2).
   */
  trangThai: 'da_in' | 'loi' | 'khong_ro';
  loiCuoi?: string;
  /** Mã sự cố (nhat-ky.ts MA_SU_CO) nếu app biết nguyên nhân. */
  loai?: string;
  /** Chỉ với khong_ro — xem LoiKhongRo.conTrongHangDoi. */
  conTrongHangDoi?: boolean;
}

/**
 * Ngữ cảnh một job đã gửi app — để sự cố/kết quả app báo về (chỉ mang jobId)
 * ghi được nhật ký kèm số hoá đơn, tên khách, và để kết quả ĐẾN TRỄ (sau hạn
 * chờ) cập nhật đúng print_jobs.
 */
export interface NguCanhJob {
  printJobId: string;
  orgId: string;
  soHoaDon: string;
  tenKhach: string | null;
  /**
   * Máy (token) đã nhận job — giám sát vòng 2 (V3): id job "<ms>-<n>" đoán
   * được, app của máy/org KHÁC không được dùng id đó để đổi print_jobs hay ghi
   * nhật ký mang hoá đơn + tên khách của org này. Chỉ tra qua `layNguCanhCua`.
   */
  token: string;
}

/** Trạng thái máy in hiện tại do app báo (`trang-thai-may-in` / `su-co`). */
export interface TinhTrangMayIn {
  ma: string;
  chiTiet?: string;
  luc: Date;
  /**
   * 'may' = cờ CẤP MÁY (GetPrinter, `trang-thai-may-in`); 'job' = chỉ thấy trên
   * một job (`su-co`). Máy in mạng nhiều khi chỉ bật cờ lỗi trên job còn cấp
   * máy vẫn "bình thường" — báo "bình thường" cấp máy KHÔNG phải bằng chứng đã
   * hết một sự cố chỉ job mới thấy (giám sát vòng 2, V1).
   */
  nguon?: 'may' | 'job';
}

interface ChoKetQua {
  resolve: (kq: KetQuaAgent) => void;
  reject: (err: Error) => void;
  hetGio: ReturnType<typeof setTimeout> | null;
}

interface AgentDangKy {
  gui: (msg: unknown) => void;
}

/**
 * Cầu dao theo máy in (25/09, giám sát vòng 1 — V4): một job vừa hỏng vì MÁY
 * IN (hết giấy, kẹt, offline… hoặc app im quá hạn chờ) thì các job SAU của
 * cùng máy GIỮ ở cho_in thay vì đổ tiếp vào hàng đợi Windows đang kẹt (mỗi job
 * thành khong_ro, người phải dọn tay — 24/09 mất cả loạt khi xoá tay hàng đợi)
 * và thay vì mỗi job chiếm 90 s của lượt cron chung mọi chi nhánh.
 *
 * Đóng lại khi có BẰNG CHỨNG máy in được: app báo `da_in` (kể cả kết quả trễ),
 * hoặc báo trạng thái máy không chặn in SAU lúc ngắt ít nhất MS_BO_QUA_BAO_CU
 * (tránh gói "bình thường" gửi trước lúc ngắt tới muộn). Không có bằng chứng
 * nào thì cứ MS_THU_LAI cho MỘT job đi thử (máy in không bật cờ cấp máy, app
 * bản cũ không báo trạng thái) — job đó thành công là đóng.
 */
export interface CauDao {
  tu: Date;
  ma: string | null;
  lyDo: string;
  /** Mốc (epoch ms) sớm nhất được cho một job đi thử. */
  thuSau: number;
  /** Lần ngắt (hoặc ngắt lại sau job thử hỏng) gần nhất — mốc bỏ qua báo cũ. */
  lucNgat: number;
}

export type XetCauDao = 'gui' | 'giu' | 'thu';

export interface AgentRegistryOptions {
  /** Hạn chờ app trả lời một job (ms). Mặc định env AI_MAY_IN_CHO_KET_QUA_MS hoặc 90 000. */
  msChoKetQua?: number;
  /** Cầu dao: bao lâu thì cho một job đi thử. Mặc định 3 phút. */
  msThuLai?: number;
  /** Đồng hồ — test tiêm được. */
  bayGio?: () => number;
}

/** Số ngữ cảnh job giữ trong bộ nhớ — đủ cho vài giờ in, không phình mãi. */
const SO_NGU_CANH_TOI_DA = 1000;
const MS_THU_LAI = 3 * 60_000;
const MS_BO_QUA_BAO_CU = 5_000;
/**
 * Trần hạn chờ: hang-doi-in coi job dang_gui quá 15 phút là mồ côi (server khởi
 * động lại giữa chừng) — hạn chờ phải NGẮN hơn hẳn để không dọn nhầm job đang chờ thật.
 */
export const MS_CHO_TOI_DA = 10 * 60_000;

function msChoMacDinh(): number {
  const n = Number(process.env.AI_MAY_IN_CHO_KET_QUA_MS);
  return Number.isFinite(n) && n >= 5_000 && n <= MS_CHO_TOI_DA ? n : 90_000;
}

export class AgentRegistry {
  /**
   * Mọi kết nối ĐANG SỐNG của từng máy, cũ → mới; job gửi qua kết nối MỚI NHẤT.
   * Giữ TẬP chứ không một ô (giám sát vòng 2): kết nối "ma" của app (client đã
   * cho nghỉ nhưng thư viện vẫn tự nối lại) đăng ký SAU kết nối thật rồi tự
   * ngắt — bản một ô để nó ghi đè rồi xoá mất đăng ký, máy im in trong khi
   * kết nối thật vẫn sống. Giờ kết nối nào rớt chỉ gỡ chính nó.
   */
  private readonly agents = new Map<string, AgentDangKy[]>();
  /**
   * Job đang chờ kết quả, khoá theo TOKEN (không theo kết nối) — giám sát
   * vòng 1 (V1): app nối lại bằng kết nối Y trong khi X chưa rớt hẳn rồi gửi
   * `ket-qua` qua Y. Bản trước giữ chờ trong bản đăng ký X nên kết quả qua Y bị
   * coi là "đến trễ", hoá đơn ĐÃ IN vẫn thành khong_ro → NV in lại → 2 tờ.
   */
  private readonly cho = new Map<string, Map<string, ChoKetQua>>();
  private readonly nguCanh = new Map<string, NguCanhJob>();
  private readonly tinhTrang = new Map<string, TinhTrangMayIn>();
  private readonly cauDao = new Map<string, CauDao>();
  private readonly msChoKetQua: number;
  private readonly msThuLai: number;
  private readonly bayGio: () => number;

  constructor(opts: AgentRegistryOptions = {}) {
    this.msChoKetQua = opts.msChoKetQua ?? msChoMacDinh();
    this.msThuLai = opts.msThuLai ?? MS_THU_LAI;
    this.bayGio = opts.bayGio ?? Date.now;
  }

  private choCua(token: string): Map<string, ChoKetQua> {
    let m = this.cho.get(token);
    if (!m) {
      m = new Map();
      this.cho.set(token, m);
    }
    return m;
  }

  /** Agent của token này kết nối WS xong gọi hàm này. Trả về hàm huỷ đăng ký. */
  dangKy(token: string, gui: (msg: unknown) => void): () => void {
    const agent: AgentDangKy = { gui };
    this.agents.set(token, [...(this.agents.get(token) ?? []), agent]);
    return () => {
      // Chỉ gỡ CHÍNH kết nối này — kết nối khác của cùng máy (cũ hay mới) giữ nguyên.
      const conLai = (this.agents.get(token) ?? []).filter((a) => a !== agent);
      if (conLai.length > 0) this.agents.set(token, conLai);
      // GIỮ tinhTrang khi hết kết nối: app nối lại (13.6 — rớt vài lần/giờ) báo
      // lại cùng trạng thái thì không phải "đổi", không ghi nhật ký trùng. Khi
      // offline layTinhTrang() trả null nên giao diện không hiện trạng thái cũ.
      else this.agents.delete(token);
      // Còn kết nối KHÁC của cùng máy (app đã nối lại) → kết quả vẫn có thể về
      // qua đó: để yên, hạn chờ vẫn canh. Không còn kết nối nào → không thể biết
      // máy in đã nhận chưa → reject rõ ràng, không để Promise treo.
      if (this.agents.has(token)) return;
      const cho = this.cho.get(token);
      if (!cho) return;
      this.cho.delete(token);
      for (const c of cho.values()) {
        if (c.hetGio) clearTimeout(c.hetGio);
        c.reject(new AgentRotGiuaChung(token));
      }
    };
  }

  coAgent(token: string): boolean {
    return this.agents.has(token);
  }

  /**
   * Gửi job cho agent của token này, resolve/reject khi agent báo qua nhanKetQua.
   * Chờ tối đa `msChoKetQua` — hết hạn reject AgentHetGioCho (xem lớp lỗi).
   */
  guiJob(token: string, job: JobIn): Promise<KetQuaAgent> {
    const agent = this.agents.get(token)?.at(-1);
    if (!agent) {
      // Chưa gửi được gì — an toàn để hàng đợi retry (giống LoiIpp guiDuoc=false).
      return Promise.reject(new AgentKhongOnline(token));
    }
    const cho = this.choCua(token);
    return new Promise<KetQuaAgent>((resolve, reject) => {
      const c: ChoKetQua = { resolve, reject, hetGio: null };
      c.hetGio = setTimeout(() => {
        // Chỉ xoá nếu vẫn là đúng lần chờ này (nhanKetQua có thể vừa xử lý).
        if (cho.get(job.id) === c) {
          cho.delete(job.id);
          reject(new AgentHetGioCho(token, this.msChoKetQua));
        }
      }, this.msChoKetQua);
      // Không giữ tiến trình sống chỉ vì hẹn giờ này (tắt server gọn).
      (c.hetGio as { unref?: () => void }).unref?.();
      cho.set(job.id, c);
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
   *
   * Trả true nếu có người đang chờ job này; false = kết quả ĐẾN TRỄ (đã hết
   * hạn chờ) hoặc lạ — agent-ws ghi nhật ký `ket_qua_tre` và tự cập nhật job.
   */
  nhanKetQua(token: string, jobId: string, kq: KetQuaAgent): boolean {
    const cacCho = this.cho.get(token);
    const cho = cacCho?.get(jobId);
    if (cho) {
      cacCho!.delete(jobId);
      if (cho.hetGio) clearTimeout(cho.hetGio);
      cho.resolve(kq);
      return true;
    }
    return false;
  }

  /** AgentClient ghi lúc gửi job — xem NguCanhJob. Giữ tối đa SO_NGU_CANH_TOI_DA mục mới nhất. */
  ghiNguCanh(jobId: string, nc: NguCanhJob): void {
    this.nguCanh.set(jobId, nc);
    while (this.nguCanh.size > SO_NGU_CANH_TOI_DA) {
      const cuNhat = this.nguCanh.keys().next().value;
      if (cuNhat === undefined) break;
      this.nguCanh.delete(cuNhat);
    }
  }

  layNguCanh(jobId: string): NguCanhJob | null {
    return this.nguCanh.get(jobId) ?? null;
  }

  /** Ngữ cảnh job CHỈ KHI job đó được gửi cho đúng máy này (xem NguCanhJob.token). */
  layNguCanhCua(token: string, jobId: string): NguCanhJob | null {
    const nc = this.nguCanh.get(jobId);
    return nc && nc.token === token ? nc : null;
  }

  /**
   * Cập nhật trạng thái máy in. `doi` = KHÁC mã cũ (chỉ ghi nhật ký khi đổi —
   * chống ồn, hợp đồng §3.3); `maCu` = null khi chưa từng biết.
   */
  capNhatTinhTrang(token: string, tt: TinhTrangMayIn): { doi: boolean; maCu: string | null } {
    const cu = this.tinhTrang.get(token);
    this.tinhTrang.set(token, tt);
    return { doi: !cu || cu.ma !== tt.ma, maCu: cu?.ma ?? null };
  }

  layTinhTrang(token: string): TinhTrangMayIn | null {
    return this.agents.has(token) ? this.tinhTrang.get(token) ?? null : null;
  }

  // ── Cầu dao (xem CauDao) ───────────────────────────────────────────────────

  /** Ngắt (hoặc ngắt LẠI sau một job thử hỏng). `moi` = trước đó đang đóng. */
  ngatCauDao(token: string, ma: string | null, lyDo: string): { moi: boolean } {
    const cu = this.cauDao.get(token);
    const bayGio = this.bayGio();
    this.cauDao.set(token, {
      tu: cu?.tu ?? new Date(bayGio),
      ma: ma ?? cu?.ma ?? null,
      lyDo,
      thuSau: bayGio + this.msThuLai,
      lucNgat: bayGio,
    });
    return { moi: !cu };
  }

  /** Đóng cầu dao (máy in được lại). Trả trạng thái cũ nếu đang ngắt, null nếu vốn đóng. */
  dongCauDao(token: string): CauDao | null {
    const cu = this.cauDao.get(token) ?? null;
    this.cauDao.delete(token);
    return cu;
  }

  /**
   * Đóng cầu dao theo báo cáo trạng thái máy KHÔNG chặn in — bỏ qua gói tới
   * trong MS_BO_QUA_BAO_CU sau lúc ngắt (có thể là gói "bình thường" cũ).
   */
  dongCauDaoTheoTrangThai(token: string): CauDao | null {
    const cu = this.cauDao.get(token);
    if (!cu) return null;
    if (this.bayGio() - cu.lucNgat < MS_BO_QUA_BAO_CU) return null;
    return this.dongCauDao(token);
  }

  /**
   * Hàng đợi hỏi trước khi gửi job cho máy này: 'gui' (bình thường), 'giu'
   * (đang ngắt — để job ở cho_in), 'thu' (đang ngắt nhưng tới lượt cho MỘT job
   * đi thử). KHÔNG đổi trạng thái: lượt thử chỉ bị tính khi job THẬT SỰ được
   * gửi (`daGuiThu`) — bản trước dời mốc ngay lúc hỏi nên Odoo lỗi đúng lúc đó
   * là nuốt mất lượt thử, phải chờ thêm 3 phút (giám sát vòng 2).
   */
  xetCauDao(token: string): XetCauDao {
    const cd = this.cauDao.get(token);
    if (!cd) return 'gui';
    return this.bayGio() < cd.thuSau ? 'giu' : 'thu';
  }

  /** Job thử đã được gửi xuống app — lượt thử kế tiếp sau MS_THU_LAI nữa. */
  daGuiThu(token: string): void {
    const cd = this.cauDao.get(token);
    if (cd) cd.thuSau = this.bayGio() + this.msThuLai;
  }

  /**
   * Các máy đang ngắt và CHƯA tới lượt thử — hàng đợi loại job của chúng ngay
   * trong câu truy vấn. Không loại thì ≥ 10 hoá đơn của máy HN đang giữ chiếm
   * trọn `take: 10` mỗi lượt và máy HCM không bao giờ tới lượt (giám sát vòng 2,
   * N1 — tái diễn lỗi đói 13.2 giữa các chi nhánh).
   */
  dangGiu(): string[] {
    const bayGio = this.bayGio();
    return [...this.cauDao.entries()].filter(([, cd]) => bayGio < cd.thuSau).map(([t]) => t);
  }

  layCauDao(token: string): CauDao | null {
    return this.cauDao.get(token) ?? null;
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
