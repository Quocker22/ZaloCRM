// SPDX-License-Identifier: AGPL-3.0-or-later
// agent-ws.ts — Namespace socket.io RIÊNG `/print-agent` cho agent PC-cầu-nối
// (chương trình chạy tại shop, nối máy in vật lý). KHÔNG dùng chung namespace
// gốc/JWT user (socket-auth.ts) vì agent không phải người dùng đăng nhập —
// nó chỉ có 1 quyền hẹp: nhận job in + báo kết quả.
//
// VÌ SAO namespace riêng thay vì thêm nhánh rẽ vào registerSocketAuth: namespace
// khác của socket.io có handshake/middleware độc lập — không sợ đụng logic
// room org/user hiện có, và agent rớt mạng không ảnh hưởng socket user khác.
//
// Task 4 (10/09, nhiều chi nhánh) — ĐIỂM SINH TỬ: trước đây auth chỉ so
// `authToken === process.env.AI_MAY_IN_AGENT_TOKEN` (1 token duy nhất cho cả
// hệ, key registry = orgId). Giờ nhiều máy = nhiều token (bảng print_agents,
// Task 1), registry key đổi sang TOKEN (agent-registry.ts). Handshake phải:
//
//   1. Token khớp 1 dòng trong print_agents  → NHẬN, key registry = token đó.
//   2. Token KHÔNG có trong bảng NHƯNG == env AI_MAY_IN_AGENT_TOKEN cũ → VẪN
//      NHẬN (tương thích agent HN cũ đang chạy prod, khai đúng token env này
//      trước khi bảng print_agents tồn tại hoặc trước khi dòng HN được seed —
//      xem plan-may-in-nhieu-chi-nhanh.md "Global Constraints"). Agent HN
//      TUYỆT ĐỐI không được gián đoạn bởi việc đổi sang định tuyến theo token.
//   3. Token không khớp gì cả → reject 'unauthorized'.
//
// So token dùng timingSafeEqual (chống timing attack), giống mẫu so authToken
// bản cũ — KHÔNG so bằng `===` cho chuỗi bí mật.
import type { Server, Socket } from 'socket.io';
import { timingSafeEqual } from 'node:crypto';
import { logger } from '../../../shared/utils/logger.js';
import { prisma } from '../../../shared/database/prisma-client.js';
import { AgentRegistry, type KetQuaAgent } from './agent-registry.js';

interface KetQuaTuAgent {
  jobId: string;
  trangThai: 'da_in' | 'loi';
  loiCuoi?: string;
}

/** Dòng print_agents tối thiểu cần cho handshake — deps test chỉ cần trả field này. */
export interface MayInTraVe {
  token: string;
}

export interface AgentWsDeps {
  /**
   * Tra 1 dòng print_agents theo token. Mặc định = query Prisma thật.
   * Inject được cho test (socket thật, DB giả) — xem agent-ws.func.ts.
   */
  layMayInTheoToken?: (token: string) => Promise<MayInTraVe | null>;
}

/** So 2 chuỗi timing-safe — độ dài khác nhau thì false ngay, KHÔNG ném lỗi
 * (timingSafeEqual của Node ném nếu 2 buffer khác length). */
function soTokenAnToan(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

async function layMayInTuDb(token: string): Promise<MayInTraVe | null> {
  const agent = await prisma.printAgent.findUnique({ where: { token } });
  return agent ? { token: agent.token } : null;
}

/**
 * Đăng ký namespace `/print-agent`. Gọi SAU registerSocketAuth ở app.ts (thứ
 * tự không bắt buộc về mặt kỹ thuật vì đây là namespace khác, nhưng giữ cùng
 * chỗ để dễ đọc thứ tự khởi tạo realtime).
 *
 * Thiếu env AI_MAY_IN_AGENT_TOKEN → KHÔNG đăng ký namespace: không để hệ
 * thống mở một cửa WS không ai canh. Biến này vẫn là "chìa khoá tương thích
 * HN" (điểm 2 ở trên) dù bảng print_agents giờ là nguồn định tuyến chính —
 * thiếu nó thì tắt hẳn tính năng (nhất quán với tu-env.ts: thiếu cấu hình =
 * tắt hẳn).
 */
export function registerAgentWs(io: Server, registry: AgentRegistry, deps: AgentWsDeps = {}): void {
  const envToken = process.env.AI_MAY_IN_AGENT_TOKEN;
  if (!envToken) {
    logger.warn('[may-in] AI_MAY_IN_AGENT_TOKEN chưa đặt — không bật WS /print-agent');
    return;
  }
  const layMayInTheoToken = deps.layMayInTheoToken ?? layMayInTuDb;

  const nsp = io.of('/print-agent');

  nsp.use((socket, next) => {
    const authToken = socket.handshake.auth?.token as string | undefined;
    if (!authToken) {
      return next(new Error('unauthorized'));
    }
    void (async () => {
      let mayIn: MayInTraVe | null = null;
      try {
        mayIn = await layMayInTheoToken(authToken);
      } catch (err) {
        // Tra DB lỗi (mất kết nối, timeout...) KHÔNG được kéo sập agent HN —
        // đây chính là "HN không gián đoạn": máy HN khai đúng token env vẫn
        // phải được nhận dù bảng print_agents không tra được lúc này. Chỉ
        // token LẠ (không khớp env) mới bị ảnh hưởng bởi lỗi DB (reject —
        // an toàn, vì không xác minh được).
        logger.error({ err }, '[may-in] lỗi tra print_agents lúc handshake — chỉ nhận nếu khớp token HN cũ');
      }
      if (mayIn && soTokenAnToan(mayIn.token, authToken)) {
        socket.data.token = authToken;
        return next();
      }
      // Không có dòng trong bảng (hoặc tra lỗi) — tương thích HN: token ==
      // env cũ vẫn nhận, coi là máy HN.
      if (soTokenAnToan(authToken, envToken)) {
        socket.data.token = authToken;
        return next();
      }
      return next(new Error('unauthorized'));
    })();
  });

  nsp.on('connection', (socket: Socket) => {
    const token = socket.data.token as string;
    logger.info(`[may-in] agent kết nối (token ...${token.slice(-4)}, socket ${socket.id})`);

    const huy = registry.dangKy(token, (msg) => {
      socket.emit('job', msg);
    });

    socket.on('ket-qua', (kq: KetQuaTuAgent) => {
      const ketQua: KetQuaAgent = { trangThai: kq.trangThai, loiCuoi: kq.loiCuoi };
      registry.nhanKetQua(token, kq.jobId, ketQua);
    });

    // VÌ SAO dựa 'disconnect' của socket.io (không phải 'close' thô của
    // net/ws): socket.io tự phát 'disconnect' cả khi transport đóng gọn gàng
    // LẪN khi ping-timeout phát hiện kết nối nửa chết (agent mất mạng đột
    // ngột, không kịp gửi FIN). Bắt 'close' ở tầng TCP/HTTP thô sẽ bỏ sót ca
    // half-open — review Task 1+2 đã chỉ đích danh lỗ này: bỏ sót thì job
    // đang chờ treo Promise mãi mãi, không bao giờ rơi vào khong_ro.
    socket.on('disconnect', (reason) => {
      logger.info(`[may-in] agent token ...${token.slice(-4)} disconnect (${reason}) — huỷ đăng ký, reject job đang chờ`);
      huy();
    });
  });
}
