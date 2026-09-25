// SPDX-License-Identifier: AGPL-3.0-or-later
// Cron MÁY IN — mỗi phút nhặt job trong print_jobs gửi ra máy in shop.
//
// Mẫu tu-soi: mutex lượt (lượt trước chưa xong thì bỏ lượt này), lỗi một lượt
// không giết cron. Mỗi phút là đủ: nhân viên bấm in xong ra máy in đứng đợi
// vài giây là bình thường ở shop; muốn nhanh hơn chỉnh AI_MAY_IN_CRON.
//
// Gate: không chọn được client nào (xem chonClientMayIn) → không bật gì cả.
import cron from 'node-cron';
import { logger } from '../../../shared/utils/logger.js';
import { prisma } from '../../../shared/database/prisma-client.js';
import { layAnhClient } from '../agent/noi-zalo/du-lieu.js';
import { AgentClient } from './agent-client.js';
import { agentRegistry } from './agent-registry.js';
import { IppClient } from './ipp-client.js';
import { agentConfigTuEnv, ippConfigTuEnv } from './tu-env.js';
import {
  chayMotLuotIn,
  donJobMoCoi,
  tachReport,
  type ClientMayIn,
  type DepsChayLuot,
  type PrismaHangDoiIn,
} from './hang-doi-in.js';
import { modelCuaReport } from './ten-file-in.js';
import { ghiNhatKy, donNhatKyCu } from './nhat-ky.js';
import { donNhatKyAppCu } from './nhat-ky-app.js';

let task: ReturnType<typeof cron.schedule> | null = null;
let dangChay = false;
/** Lần dọn nhật ký máy in gần nhất (ms) — dọn tối đa 1 lần/ngày. */
let lanDonNhatKy = 0;

/**
 * Chọn client máy in cho cron — hàm THUẦN (không đọc process.env trực tiếp,
 * nhận qua deps) để test được không cần dựng cron.schedule/DB/Odoo (Task 4).
 *
 * Thứ tự ưu tiên: AgentClient (kênh chính, đi qua PC-cầu-nối shop, không cần
 * mở cổng máy in ra Tailscale) → IppClient (fallback, gọi IPP thẳng qua env
 * cũ) → null (không bật cron — thiếu cấu hình = tắt hẳn, cùng triết lý mọi
 * nơi khác trong module này).
 *
 * VÌ SAO registry KHÔNG truyền qua deps mặc định mà import singleton: cron
 * và WS layer (agent-ws.ts, Task 3) PHẢI thấy chung một AgentRegistry để
 * cron thấy được agent đã đăng ký qua WS — xem chú thích ở agent-registry.ts.
 * Test vẫn ghi đè được qua deps.registry khi cần cô lập trạng thái.
 *
 * Task 5 (10/09): hàm này giờ chỉ còn dùng để BIẾT "có cấu hình máy in nào
 * không" lúc startMayInCron() gate bật/tắt cron (xem bên dưới) — chọn CLIENT
 * THẬT cho từng job giờ là việc của `taoChonClient()`, vì 1 AgentClient/token
 * duy nhất không còn đúng khi có nhiều máy (nhiều token) song song.
 */
export function chonClientMayIn(
  deps: { env?: NodeJS.ProcessEnv; registry?: typeof agentRegistry } = {},
): ClientMayIn | null {
  const env = deps.env ?? process.env;
  const registry = deps.registry ?? agentRegistry;
  const agentCfg = agentConfigTuEnv(env);
  if (agentCfg) {
    // Task 4 (10/09): registry giờ định tuyến theo TOKEN, không phải orgId
    // (agent-registry.ts). Client trả ở đây dùng token env AI_MAY_IN_AGENT_TOKEN
    // (máy MẶC ĐỊNH/HN) — chỉ dùng làm client "đại diện" cho việc gate cron
    // bật/tắt; xử lý ĐÚNG máy cho từng job là `taoChonClient()`.
    const { orgId: _orgId, ...cfg } = agentCfg;
    const token = env.AI_MAY_IN_AGENT_TOKEN!.trim();
    return new AgentClient(registry, token, cfg);
  }
  const ippCfg = ippConfigTuEnv(env);
  if (ippCfg) {
    return new IppClient(ippCfg);
  }
  return null;
}

/**
 * Factory chọn client THEO TOKEN của từng job (Task 5, "cron gửi job theo
 * máy đích") — thay cho `chonClientMayIn()` cũ vốn tạo DUY NHẤT 1 AgentClient
 * dùng chung cho mọi job bất kể job đó thuộc máy nào.
 *
 * QUYẾT ĐỊNH THIẾT KẾ (mô tả cho report Task 5):
 *   - Mỗi token gặp lần đầu → tạo 1 AgentClient(registry, token, cfg) rồi
 *     CACHE lại (Map theo token) — registry là nguồn định tuyến thật (Task 4:
 *     key theo token), AgentClient chỉ là lớp mỏng bọc quanh 1 token cố định
 *     nên tạo lại mỗi lượt cron cũng vô hại, nhưng cache rẻ hơn và tránh rác.
 *   - `cfg` (paperSize/tray/copies) dùng CHUNG cho mọi máy, đọc 1 lần từ env
 *     — đây là cấu hình "kiểu in" (khổ giấy A5, tray-2) của hệ, KHÔNG phải
 *     đặc tính riêng của từng chi nhánh; print_agents (Task 1) không có cột
 *     paperSize/tray nên không có gì khác để tra theo token. Nếu sau này một
 *     chi nhánh cần khổ giấy khác, đó là mở rộng ở Task 1 (schema), không
 *     phải ở đây.
 *   - Token MẶC ĐỊNH (agentToken null của job) = `AI_MAY_IN_AGENT_TOKEN` từ
 *     env — CHỌN ENV thay vì query `print_agents WHERE laMacDinh=true`, vì:
 *     (a) tương thích 100% với cron hiện tại đang chạy prod (không đổi hành
 *     vi cho máy HN có sẵn), (b) đơn giản — không cần async/DB trong factory
 *     THUẦN vốn phải test được không cần Prisma thật (giữ đúng tinh thần
 *     "hàm thuần dễ test" đã áp dụng cho chonClientMayIn ở Task 4), (c) nếu
 *     env thiếu (chưa cấu hình máy in nào) → trả null, ĐÚNG bất biến "thiếu
 *     cấu hình = tắt hẳn" xuyên suốt module.
 *   - IppClient (không có khái niệm agent/token) giữ nguyên NHÁNH CŨ: nếu hệ
 *     chỉ cấu hình IPP (không có AI_MAY_IN_AGENT_TOKEN), MỌI job (kể cả job
 *     có agentToken cụ thể — hệ thuần-IPP không hỗ trợ nhiều máy) đều đi qua
 *     IppClient duy nhất — không có "nhiều máy IPP theo token" trong scope
 *     Task 5.
 *   - Token lạ / không phải token mặc định NHƯNG cũng không tra ra được máy
 *     nào (vd print_agents đã xoá dòng đó) — factory KHÔNG throw, vẫn trả
 *     AgentClient(registry, token, cfg): registry.guiJob(token) sẽ tự ném
 *     AgentKhongOnline vì token không có ai `dangKy` — kết quả cuối giống hệt
 *     "máy offline" (giữ cho_in, không fallback máy khác), không cần factory
 *     phải biết trước máy nào "tồn tại" hay không — registry đã là nguồn thật
 *     duy nhất cho câu hỏi "ai đang online".
 */
export function taoChonClient(
  deps: { env?: NodeJS.ProcessEnv; registry?: typeof agentRegistry } = {},
): (agentToken: string | null) => ClientMayIn | null {
  const env = deps.env ?? process.env;
  const registry = deps.registry ?? agentRegistry;
  const agentCfg = agentConfigTuEnv(env);
  const ippCfg = !agentCfg ? ippConfigTuEnv(env) : null;

  if (!agentCfg) {
    // Không có kênh agent — hệ thuần-IPP (nếu có cấu hình) dùng 1 client duy
    // nhất cho MỌI job, không phân biệt agentToken (IPP không nói token).
    const ippClient = ippCfg ? new IppClient(ippCfg) : null;
    return () => ippClient;
  }

  const { orgId: _orgId, ...cfg } = agentCfg;
  const tokenMacDinh = env.AI_MAY_IN_AGENT_TOKEN!.trim();
  const cache = new Map<string, AgentClient>();
  const layHoacTao = (token: string): AgentClient => {
    let c = cache.get(token);
    if (!c) {
      c = new AgentClient(registry, token, cfg);
      cache.set(token, c);
    }
    return c;
  };

  return (agentToken: string | null): ClientMayIn | null => {
    const token = agentToken ?? tokenMacDinh;
    return layHoacTao(token);
  };
}

export function startMayInCron(): void {
  if (task) return;
  // Gate bật/tắt vẫn dùng chonClientMayIn() (client "đại diện" — chỉ để biết
  // có cấu hình máy in nào chưa); client THẬT gửi job theo từng job dùng
  // chonClient (factory, Task 5) tạo ngay dưới đây.
  const clientDaiDien = chonClientMayIn();
  if (!clientDaiDien) {
    logger.info('[may-in] chưa cấu hình AI_MAY_IN_AGENT_TOKEN lẫn AI_MAY_IN_IPP_URL — không bật cron in');
    return;
  }
  const anhClient = layAnhClient();
  if (!anhClient) {
    logger.warn('[may-in] có cấu hình máy in nhưng thiếu ODOO_URL — không tải được PDF, không bật cron');
    return;
  }
  const chonClient = taoChonClient();
  const lich = process.env.AI_MAY_IN_CRON ?? '* * * * *';
  // Job cũ agentToken=null đi máy mặc định (env) — mọi chỗ quy về token máy.
  const tokenMayCua = (agentToken: string | null): string | null =>
    agentToken ?? process.env.AI_MAY_IN_AGENT_TOKEN?.trim() ?? null;
  const deps: DepsChayLuot = {
    prisma: prisma as unknown as PrismaHangDoiIn,
    chonClient,
    // Job KHÔNG GIÁ (26/08) mang đuôi #khong_gia trong cột report — tách
    // ra rồi truyền cờ để Odoo render bản ẩn giá (incokit_hide_price).
    taiPdf: (hoaDonId, report) => {
      const r = tachReport(report);
      return anhClient.taiPdf(hoaDonId, r.report, { khongGia: r.khongGia });
    },
    // Tên khách để đặt tên file in "AI-<số HĐ>-<Ten_Khach>-<jobId>.pdf".
    // Mẫu in lạ (không suy ra model) → null → "Khong_ro", vẫn in.
    layTenKhach: (hoaDonId, report) => {
      const model = modelCuaReport(tachReport(report).report);
      return model ? anhClient.docTenKhach(model, hoaDonId) : Promise.resolve(null);
    },
    // Nhật ký máy in (trang Cài đặt › Máy in) — fire-and-forget, không chặn in.
    nhatKy: (e) => ghiNhatKy({
      loai: e.loai,
      noiDung: e.noiDung,
      orgId: e.job.orgId,
      agentToken: tokenMayCua(e.job.agentToken),
      printJobId: e.job.id,
      soHoaDon: e.job.soHoaDon,
      tenKhach: e.tenKhach ?? null,
      chiTiet: e.chiTiet ?? null,
    }),
    // Cầu dao theo máy (agent-registry.ts) — chỉ có nghĩa với kênh app PC.
    cauDao: {
      xet: (agentToken) => {
        const t = tokenMayCua(agentToken);
        return t ? agentRegistry.xetCauDao(t) : 'gui';
      },
      ngat: (agentToken, ma, lyDo) => {
        const t = tokenMayCua(agentToken);
        return t ? agentRegistry.ngatCauDao(t, ma, lyDo) : { moi: false };
      },
      daThu: (agentToken) => {
        const t = tokenMayCua(agentToken);
        if (t) agentRegistry.daGuiThu(t);
      },
      // Quy về giá trị cột agent_token: máy mặc định (env) còn là job agentToken NULL.
      dangGiu: () => {
        const macDinh = process.env.AI_MAY_IN_AGENT_TOKEN?.trim() ?? null;
        return agentRegistry.dangGiu().flatMap((t) => (t === macDinh ? [t, null] : [t]));
      },
    },
    // Chỉ kênh app PC biết "app có đang kết nối không"; kênh IPP luôn coi là có.
    coMay: (agentToken) => {
      const t = tokenMayCua(agentToken);
      return t && chonClient(agentToken) instanceof AgentClient ? agentRegistry.coAgent(t) : true;
    },
    onLoi: (jobId, err) => logger.error({ err, jobId }, '[may-in] job lỗi'),
  };
  task = cron.schedule(lich, async () => {
    if (dangChay) return; // lượt trước chưa xong — máy in chậm là chuyện thường
    dangChay = true;
    try {
      // Job dang_gui mồ côi (server khởi động lại giữa lúc chờ app) → khong_ro + nhật ký.
      const moCoi = await donJobMoCoi(deps);
      if (moCoi > 0) logger.warn({ n: moCoi }, '[may-in] job dang_gui mồ côi → khong_ro');
      await chayMotLuotIn(deps);
    } catch (err) {
      logger.error({ err }, '[may-in] lượt in lỗi');
    } finally {
      dangChay = false;
    }
    // Giữ nhật ký 90 ngày, nhật ký app 30 ngày — dọn SAU lượt in, tối đa 1 lần/ngày,
    // lỗi thì nuốt (hai hàm dọn tự bắt lỗi, trả 0).
    if (Date.now() - lanDonNhatKy > 24 * 3600 * 1000) {
      lanDonNhatKy = Date.now();
      void donNhatKyCu(90).then((n) => {
        if (n > 0) logger.info({ n }, '[may-in] đã dọn nhật ký máy in cũ hơn 90 ngày');
      });
      void donNhatKyAppCu(30).then((n) => {
        if (n > 0) logger.info({ n }, '[may-in] đã dọn nhật ký app máy in cũ hơn 30 ngày');
      });
    }
  });
  // VÌ SAO không log uri/token: AgentClient không có uri máy in (agent PC tự
  // biết), IppClient thì có nhưng không đáng tách riêng nhánh log — kenh đủ
  // để biết cron bật đường nào mà không rò rỉ token agent ra log.
  logger.info(
    { kenh: clientDaiDien instanceof AgentClient ? 'agent' : 'ipp', lich },
    '[may-in] cron đã bật',
  );
}

/** Cho test/shutdown: dừng và quên task. */
export function stopMayInCron(): void {
  task?.stop();
  task = null;
}
