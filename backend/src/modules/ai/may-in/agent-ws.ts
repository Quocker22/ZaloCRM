// SPDX-License-Identifier: AGPL-3.0-or-later
// agent-ws.ts — Namespace socket.io RIÊNG `/print-agent` cho agent PC-cầu-nối
// (chương trình chạy tại shop, nối máy in vật lý). KHÔNG dùng chung namespace
// gốc/JWT user (socket-auth.ts) vì agent không phải người dùng đăng nhập —
// nó chỉ có 1 quyền hẹp: nhận job in + báo kết quả. Token cố định riêng
// (env AI_MAY_IN_AGENT_TOKEN) tách bạch 2 mặt phẳng auth, agent lộ token
// cũng không leo thang được lên quyền user thật.
//
// VÌ SAO namespace riêng thay vì thêm nhánh rẽ vào registerSocketAuth: namespace
// khác của socket.io có handshake/middleware độc lập — không sợ đụng logic
// room org/user hiện có, và agent rớt mạng không ảnh hưởng socket user khác.
import type { Server, Socket } from 'socket.io';
import { logger } from '../../../shared/utils/logger.js';
import { AgentRegistry, type KetQuaAgent } from './agent-registry.js';

interface KetQuaTuAgent {
  jobId: string;
  trangThai: 'da_in' | 'loi';
  loiCuoi?: string;
}

/**
 * Đăng ký namespace `/print-agent`. Gọi SAU registerSocketAuth ở app.ts (thứ
 * tự không bắt buộc về mặt kỹ thuật vì đây là namespace khác, nhưng giữ cùng
 * chỗ để dễ đọc thứ tự khởi tạo realtime).
 *
 * Thiếu env AI_MAY_IN_AGENT_TOKEN → KHÔNG đăng ký namespace: không để hệ
 * thống mở một cửa WS không ai canh (token undefined so sánh === sẽ luôn
 * false nên "an toàn" về logic, nhưng vẫn tốt hơn không mở cửa khi tính năng
 * chưa được cấu hình — nhất quán với tu-env.ts: thiếu cấu hình = tắt hẳn).
 */
export function registerAgentWs(io: Server, registry: AgentRegistry): void {
  const token = process.env.AI_MAY_IN_AGENT_TOKEN;
  if (!token) {
    logger.warn('[may-in] AI_MAY_IN_AGENT_TOKEN chưa đặt — không bật WS /print-agent');
    return;
  }

  const nsp = io.of('/print-agent');

  nsp.use((socket, next) => {
    const authToken = socket.handshake.auth?.token as string | undefined;
    const orgId = socket.handshake.auth?.orgId as string | undefined;
    if (!orgId || authToken !== token) {
      return next(new Error('unauthorized'));
    }
    socket.data.orgId = orgId;
    return next();
  });

  nsp.on('connection', (socket: Socket) => {
    const orgId = socket.data.orgId as string;
    logger.info(`[may-in] agent kết nối cho org ${orgId} (socket ${socket.id})`);

    const huy = registry.dangKy(orgId, (msg) => {
      socket.emit('job', msg);
    });

    socket.on('ket-qua', (kq: KetQuaTuAgent) => {
      const ketQua: KetQuaAgent = { trangThai: kq.trangThai, loiCuoi: kq.loiCuoi };
      registry.nhanKetQua(orgId, kq.jobId, ketQua);
    });

    // VÌ SAO dựa 'disconnect' của socket.io (không phải 'close' thô của
    // net/ws): socket.io tự phát 'disconnect' cả khi transport đóng gọn gàng
    // LẪN khi ping-timeout phát hiện kết nối nửa chết (agent mất mạng đột
    // ngột, không kịp gửi FIN). Bắt 'close' ở tầng TCP/HTTP thô sẽ bỏ sót ca
    // half-open — review Task 1+2 đã chỉ đích danh lỗ này: bỏ sót thì job
    // đang chờ treo Promise mãi mãi, không bao giờ rơi vào khong_ro.
    socket.on('disconnect', (reason) => {
      logger.info(`[may-in] agent org ${orgId} disconnect (${reason}) — huỷ đăng ký, reject job đang chờ`);
      huy();
    });
  });
}
