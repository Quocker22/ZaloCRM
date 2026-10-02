// SPDX-License-Identifier: AGPL-3.0-or-later
// LỚP "CRM TỰ ĐỘNG" của trang Bản đồ tin (docs/78 C3) — CHỈ ĐỌC.
//
// Liệt kê những thứ CRM TỰ gửi (không phải bot, không phải người bấm) cho MỘT org: gửi gì, khi nào, tới đâu, đang bật hay
// tắt và vì sao. Trang Bản đồ tin vẽ chúng ở dải "CRM tự động" — không sửa được ở đó (mỗi mục có trang cài đặt riêng).
//
// Nguồn sự thật (đọc lại khi đổi mã gửi tương ứng):
//   • báo người trực / kỹ thuật   — ai/agent/noi-zalo/dich-bao.ts + bao-nhan-vien.ts (AgentNotifyTarget; DB rỗng ⇒ env
//     AI_AGENT_THREAD_BAO_SALE, KHÔNG cộng dồn), chỉ chạy trong luồng khách (AiConfig.agentKhachEnabled + đủ env Odoo);
//   • lịch hẹn                    — contacts/appointment-zalo-service.ts (lúc tạo) + appointment-reminder.ts (nhắc 1/3/6 giờ),
//     gửi qua system-notify-service (nick hệ thống → tin riêng sale phụ trách); bật bằng Organization.appointmentZaloReminderEnabled;
//     appointment-digest.ts (báo quản lý) CÓ MÃ nhưng KHÔNG cron nào gọi; cron 08:00 phát socket `appointment:reminder`;
//   • chào nhóm                   — ai/agent/noi-zalo/chao-nhom.ts: KHÔNG có công tắc; chặn từng nhóm bằng Conversation.botGroupBlocked;
//   • nick hệ thống               — system-notifications/internal-contact-handshake-hook.ts (mã xác nhận 4 số khi NV đồng ý kết bạn);
//   • chuyển sale (RAG)           — ai/knowledge/auto-reply-wiring.ts (AiConfig.autoReplyEnabled; UID sale từ env AI_HANDOFF_SALE_ZALO_UID);
//   • trợ lý AI trả lời khách     — ai/agent/noi-zalo/luong-khach.ts (agent khách) → ai/knowledge/auto-reply-wiring.ts (RAG cũ);
//     cả hai cần AiConfig.autoReplyEnabled. IM ở nhóm bot phụ trách (docs/79 T6 — bot-quyen/nhom-bot-phu-trach.ts), cùng
//     câu báo ảnh hỏng trong nhóm (luong-media.ts), chào nhóm, agent NHÂN VIÊN + máy gom đơn (luong-nhan-vien.ts) và đọc
//     ảnh/PDF trong nhóm (luong-media.ts docVaChuyenTiep — không tốn OCR); số tin đã im đếm trong tiến trình (demAiKhachBoQua);
//   • thông báo đẩy               — push/push-service.ts (env FIREBASE_SERVICE_ACCOUNT_JSON|PATH — toàn máy chủ);
//   • máy in                      — ai/may-in/su-kien-in.ts: CRM KHÔNG gửi tin sự cố; chỉ ghi print_su_kien/print_su_co cho bot đọc.
//
// Không trả threadId / UID / số điện thoại: chỉ tên gọi + loại đích (trang quản trị, nhưng bản đồ không cần định danh).
import { prisma } from '../../shared/database/prisma-client.js';
import { parseOffsetsHours } from '../contacts/appointment-reminder.js';
import { demAiKhachBoQua, type LyDoAiKhachBoQua } from './nhom-bot-phu-trach.js';

/** Loại đích của một mục CRM — trang ánh xạ sang hàng của dải "CRM tự động". */
export const LOAI_DICH_CRM = ['nguoi_truc', 'sale_phu_trach', 'nhom_zalo', 'ung_dung', 'bot'] as const;
export type LoaiDichCrm = (typeof LOAI_DICH_CRM)[number];

export interface DichCrm {
  ten: string;
  /** nhom = nhóm Zalo · ca_nhan = tin riêng · ung_dung = trong app / điện thoại · bot = bot đọc sổ */
  loai: 'nhom' | 'ca_nhan' | 'ung_dung' | 'bot';
  bat: boolean;
}

export interface MucCrmTuDong {
  id: string;
  ten: string;
  /** mã pha của bot (hop-dong-ban-do-tin.md §2) — cột trên bản đồ */
  pha: string;
  loai_dich: LoaiDichCrm;
  bat: boolean;
  /** vì sao đang tắt / không gửi (null khi bật) */
  ly_do_tat: string | null;
  khi_nao: string;
  nguon_ma: string;
  /** chỉnh ở đâu (đường dẫn trang CRM) — null khi chỉ chỉnh được bằng env / DB */
  chinh_o: string | null;
  dich: DichCrm[];
  ghi_chu: string | null;
  /** cạnh "CRM tự động" sang khối của ảnh chụp bot (id composer/nguồn) — trang chỉ vẽ khi id có trong ảnh chụp */
  dan_toi: { den: string; vi_sao: string }[];
}

/** Dữ liệu đã đọc cho MỘT org (tách khỏi truy vấn để test thuần). */
export interface DuLieuCrm {
  aiConfig: { agentKhachEnabled: boolean; autoReplyEnabled: boolean } | null;
  dichBao: Array<{ tenGoi: string; loaiDich: string; nhanKhachCanHoTro: boolean; nhanBotSuCo: boolean; enabled: boolean }>;
  org: {
    appointmentZaloReminderEnabled: boolean;
    appointmentReminderOffsetsHours: unknown;
    coNickHeThong: boolean;
    nickHeThongKetNoi: boolean;
  } | null;
  soNguoiNhanSanSang: number;
  soNhomChanChao: number;
  soMayIn: number;
  /** Số tin trợ lý AI khách của CRM đã IM theo lý do (tiến trình hiện tại — docs/79 T6). Vắng = 0. */
  aiKhachBoQua?: Record<LyDoAiKhachBoQua, number>;
}

export interface MoiTruongCrm {
  /** duCauHinh() của luồng khách — đủ ODOO_URL/DB/USERNAME/PASSWORD */
  odooDu: boolean;
  threadBaoSaleEnv: boolean;
  handoffSaleEnv: boolean;
  firebase: boolean;
}

export function docMoiTruong(env: NodeJS.ProcessEnv = process.env): MoiTruongCrm {
  return {
    odooDu: Boolean(env.ODOO_URL && env.ODOO_DB && env.ODOO_USERNAME && env.ODOO_PASSWORD),
    threadBaoSaleEnv: Boolean(env.AI_AGENT_THREAD_BAO_SALE),
    handoffSaleEnv: Boolean(env.AI_HANDOFF_SALE_ZALO_UID?.trim()),
    firebase: Boolean(env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() || env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim()),
  };
}

/** Câu dùng chung cho mọi mục CRM tự nói vào nhóm (docs/79 T6). */
const IM_NHOM_BOT = 'Im ở nhóm bot phụ trách (nhóm có chức năng trên trang Quyền bot — bot trả lời ở đó).';

/** Trợ lý AI trả lời khách của CRM (agent khách → RAG cũ) — im ở nhóm bot phụ trách (docs/79 T6). */
function mucTroLyKhach(du: DuLieuCrm, mt: MoiTruongCrm): MucCrmTuDong {
  const bat = !!du.aiConfig?.autoReplyEnabled;
  const agent = !!du.aiConfig?.agentKhachEnabled && mt.odooDu;
  const bo = du.aiKhachBoQua ?? { nhom_do_bot_phu_trach: 0, tra_cuu_loi: 0 };
  return {
    id: 'crm_tro_ly_khach',
    ten: 'Trợ lý AI trả lời khách (CRM)',
    pha: 'hoi',
    loai_dich: 'nhom_zalo',
    bat,
    ly_do_tat: bat ? null : 'Tự trả lời AI đang tắt (Cài đặt AI › tự trả lời)',
    khi_nao: `Khách nhắn riêng, hoặc tag nick trong nhóm CHƯA xếp loại ⇒ ${agent ? 'agent khách (tool-calling)' : 'RAG cũ'} trả lời. `
      + 'Im ở nhóm bot phụ trách: nhóm có chức năng trên trang Quyền bot (chủ xếp hoặc mặc định) thì bot trả lời, trợ lý CRM im '
      + '— cả agent nhân viên / máy gom đơn và đọc ảnh của CRM trong nhóm đó.',
    nguon_ma: 'backend/src/modules/ai/agent/noi-zalo/luong-khach.ts (xuLyTinKhach) · ai/knowledge/auto-reply-wiring.ts '
      + '(runAutoReplyForMessage) · bot-quyen/nhom-bot-phu-trach.ts (aiKhachPhaiImONhom)',
    chinh_o: '/settings/crm/ai-assistant',
    dich: [
      { ten: 'Khách nhắn riêng', loai: 'ca_nhan', bat },
      { ten: 'Nhóm chưa xếp loại (khi tag nick) — im ở nhóm bot phụ trách', loai: 'nhom', bat },
    ],
    ghi_chu: `${IM_NHOM_BOT} Không tra được trang Quyền bot ⇒ cũng im ở nhóm (không bao giờ trả lời đôi). `
      + `Từ lúc máy chủ chạy: đã im ${bo.nhom_do_bot_phu_trach} tin ở nhóm bot phụ trách (mọi đường: khách, nhân viên, đọc ảnh), `
      + `${bo.tra_cuu_loi} tin vì tra lỗi `
      + '(log ai_khach_bo_qua).',
    dan_toi: [],
  };
}

const loaiDichBao = (l: string): DichCrm['loai'] => (l === 'ca_nhan' ? 'ca_nhan' : 'nhom');

/** Một loại việc báo (khach_can_ho_tro | bot_su_co) — đúng thứ tự ưu tiên của dich-bao.ts: DB có ⇒ dùng DB, rỗng ⇒ env. */
function mucBao(
  du: DuLieuCrm, mt: MoiTruongCrm, loai: 'khach_can_ho_tro' | 'bot_su_co',
): MucCrmTuDong {
  const nhan = (d: DuLieuCrm['dichBao'][number]) => (loai === 'khach_can_ho_tro' ? d.nhanKhachCanHoTro : d.nhanBotSuCo);
  const dangDung = du.dichBao.filter((d) => d.enabled && nhan(d));
  const dich: DichCrm[] = du.dichBao
    .filter(nhan)
    .map((d) => ({ ten: d.tenGoi, loai: loaiDichBao(d.loaiDich), bat: d.enabled }));
  let ghiChu: string | null = null;
  if (dangDung.length === 0 && mt.threadBaoSaleEnv) {
    dich.push({ ten: 'Nhóm khai trong env AI_AGENT_THREAD_BAO_SALE (dự phòng)', loai: 'nhom', bat: true });
    ghiChu = 'Chưa đặt nơi nhận trên CRM ⇒ đang rơi về nhóm khai trong env máy chủ (không cộng dồn: đặt một nơi nhận là env thôi nhận).';
  }
  const luongKhach = !!du.aiConfig?.agentKhachEnabled;
  const coDich = dangDung.length > 0 || mt.threadBaoSaleEnv;
  const lyDo = !luongKhach ? 'Luồng bot tư vấn khách đang tắt (Cài đặt AI › công tắc agent khách)'
    : !mt.odooDu ? 'Máy chủ thiếu cấu hình Odoo — luồng khách không chạy'
      : !coDich ? 'Chưa có nơi nhận nào (và không có env dự phòng)' : null;
  const laKhach = loai === 'khach_can_ho_tro';
  return {
    id: laKhach ? 'crm_khach_can_ho_tro' : 'crm_bot_su_co',
    ten: laKhach ? 'Báo người trực: khách cần hỗ trợ' : 'Báo kỹ thuật: bot gặp sự cố',
    pha: laKhach ? 'hoi' : 'he_thong',
    loai_dich: 'nguoi_truc',
    bat: lyDo === null,
    ly_do_tat: lyDo,
    khi_nao: laKhach
      ? 'Bot tư vấn KHÁCH gặp ảnh/voice/file/link/danh thiếp, khách bực, hoặc xin gặp sale — tối đa một tin mỗi hội thoại mỗi 10 phút.'
      : 'Bot tư vấn KHÁCH bí không trả lời được, lỗi sau khi gọi tool, hoặc khách vượt giới hạn tin.',
    nguon_ma: 'backend/src/modules/ai/agent/noi-zalo/bao-nhan-vien.ts (baoNhanVien) · dich-bao.ts (layDichBao)',
    chinh_o: '/settings/crm/agent-notify',
    dich,
    ghi_chu: ghiChu,
    dan_toi: [],
  };
}

/** Dựng danh sách mục CRM tự động — thuần (không I/O). */
export function dungCrmTuDong(du: DuLieuCrm, mt: MoiTruongCrm): MucCrmTuDong[] {
  const org = du.org;
  const hen = !!org?.appointmentZaloReminderEnabled;
  const lyDoHen = !hen ? 'Chưa bật "Nhắc lịch hẹn qua Zalo" của tổ chức'
    : !org?.coNickHeThong ? 'Chưa chọn nick hệ thống (Cài đặt › Tổ chức › Thông báo hệ thống)'
      : !org.nickHeThongKetNoi ? 'Nick hệ thống đang mất kết nối' : null;
  const dichSale: DichCrm[] = [{
    ten: `Sale phụ trách lịch hẹn — tin riêng từ nick hệ thống (${du.soNguoiNhanSanSang} NV đã sẵn sàng nhận)`,
    loai: 'ca_nhan', bat: lyDoHen === null,
  }];
  const moc = parseOffsetsHours(org?.appointmentReminderOffsetsHours);

  const heThong = !!org?.coNickHeThong;
  const muc: MucCrmTuDong[] = [
    mucBao(du, mt, 'khach_can_ho_tro'),
    mucBao(du, mt, 'bot_su_co'),
    mucTroLyKhach(du, mt),
    {
      id: 'crm_lich_hen_tao',
      ten: 'Báo sale: lịch hẹn mới + nhắc Zalo',
      pha: 'bao_cao',
      loai_dich: 'sale_phu_trach',
      bat: lyDoHen === null,
      ly_do_tat: lyDoHen,
      khi_nao: 'Ngay khi có người tạo lịch hẹn có sale phụ trách — gửi tin báo và tạo thẻ nhắc hẹn Zalo trong khung chat nick hệ thống ↔ sale (đổi giờ thì sửa thẻ).',
      nguon_ma: 'backend/src/modules/contacts/appointment-zalo-service.ts (pushAppointmentOnCreate)',
      chinh_o: '/settings/crm/appointments',
      dich: dichSale,
      ghi_chu: null,
      dan_toi: [],
    },
    {
      id: 'crm_lich_hen_nhac',
      ten: 'Nhắc sale cập nhật kết quả hẹn',
      pha: 'bao_cao',
      loai_dich: 'sale_phu_trach',
      bat: lyDoHen === null,
      ly_do_tat: lyDoHen,
      khi_nao: `Sau giờ hẹn ${moc.reduce<number[]>((a, h) => [...a, (a[a.length - 1] ?? 0) + h], []).join(' / ')} giờ mà lịch còn "đã hẹn"/"quá hạn" — tối đa ${moc.length} lần, kèm link đánh dấu xong.`,
      nguon_ma: 'backend/src/modules/contacts/appointment-reminder.ts (sendActionPrompts, cron 5 phút)',
      chinh_o: '/settings/crm/appointments',
      dich: dichSale,
      ghi_chu: null,
      dan_toi: [],
    },
    {
      id: 'crm_lich_hen_quan_ly',
      ten: 'Báo quản lý: lịch hẹn bỏ dở',
      pha: 'bao_cao',
      loai_dich: 'sale_phu_trach',
      bat: false,
      ly_do_tat: 'Có mã (appointment-digest.ts) nhưng chưa nối vào lịch chạy nào — không bao giờ gửi',
      khi_nao: 'Thiết kế: sau 3 lần nhắc mà sale vẫn chưa cập nhật ⇒ báo trưởng nhóm.',
      nguon_ma: 'backend/src/modules/contacts/appointment-digest.ts (sendManagerAppointmentDigest — không ai gọi)',
      chinh_o: null,
      dich: [{ ten: 'Trưởng nhóm của sale', loai: 'ca_nhan', bat: false }],
      ghi_chu: null,
      dan_toi: [],
    },
    {
      id: 'crm_lich_hen_app',
      ten: 'Nhắc lịch hẹn ngày mai (trong app)',
      pha: 'bao_cao',
      loai_dich: 'ung_dung',
      bat: true,
      ly_do_tat: null,
      khi_nao: '08:00 mỗi ngày — lịch hẹn của ngày mai chưa nhắc.',
      nguon_ma: 'backend/src/modules/contacts/appointment-reminder.ts (cron 0 1 * * * → socket appointment:reminder)',
      chinh_o: null,
      dich: [{ ten: 'Người đang mở CRM', loai: 'ung_dung', bat: true }],
      ghi_chu: 'Không có công tắc. Sự kiện socket phát cho MỌI phiên đang mở, không lọc theo tổ chức.',
      dan_toi: [],
    },
    {
      id: 'crm_chao_nhom',
      ten: 'Chào nhóm mới',
      pha: 'he_thong',
      loai_dich: 'nhom_zalo',
      bat: true,
      ly_do_tat: null,
      khi_nao: 'Khi một nick của tổ chức vừa được thêm vào nhóm Zalo — chào một lần duy nhất theo khuôn cố định (+ tối đa một câu ngữ cảnh đã lọc).',
      nguon_ma: 'backend/src/modules/ai/agent/noi-zalo/chao-nhom.ts (chaoNhomKhiThem)',
      chinh_o: null,
      dich: [{ ten: 'Nhóm vừa thêm nick', loai: 'nhom', bat: true }],
      ghi_chu: `Không có công tắc tổ chức. Nhóm đang chặn chào: ${du.soNhomChanChao} (cột bot_group_blocked — chỉ đặt được trong DB). ${IM_NHOM_BOT}`,
      dan_toi: [],
    },
    {
      id: 'crm_ma_xac_nhan',
      ten: 'Mã xác nhận nick hệ thống',
      pha: 'he_thong',
      loai_dich: 'sale_phu_trach',
      bat: heThong,
      ly_do_tat: heThong ? null : 'Chưa chọn nick hệ thống',
      khi_nao: 'NV đồng ý lời mời kết bạn của nick hệ thống ⇒ gửi mã 4 số để NV gõ lại xác nhận.',
      nguon_ma: 'backend/src/modules/system-notifications/internal-contact-handshake-hook.ts',
      chinh_o: '/settings/org/system-notifications',
      dich: [{ ten: 'NV vừa kết bạn — tin riêng', loai: 'ca_nhan', bat: heThong }],
      ghi_chu: null,
      dan_toi: [],
    },
    {
      id: 'crm_chuyen_sale',
      ten: 'Chuyển khách sang sale (nhóm mới)',
      pha: 'chot',
      loai_dich: 'nhom_zalo',
      bat: !!du.aiConfig?.autoReplyEnabled && mt.handoffSaleEnv,
      ly_do_tat: !du.aiConfig?.autoReplyEnabled ? 'Tự trả lời (RAG) đang tắt'
        : !mt.handoffSaleEnv ? 'Máy chủ chưa khai AI_HANDOFF_SALE_ZALO_UID' : null,
      khi_nao: 'Tự trả lời RAG cần chuyển sale / khách chốt ⇒ tạo nhóm Zalo gồm sale + khách và gửi đơn vào đó.',
      nguon_ma: 'backend/src/modules/ai/knowledge/auto-reply-wiring.ts (runAutoReplyForMessage)',
      chinh_o: '/settings/crm/ai-assistant',
      dich: [{ ten: 'Nhóm mới: sale + khách', loai: 'nhom', bat: !!du.aiConfig?.autoReplyEnabled && mt.handoffSaleEnv }],
      ghi_chu: `UID sale lấy từ env máy chủ (chung mọi tổ chức). ${IM_NHOM_BOT}`,
      dan_toi: [],
    },
    {
      id: 'crm_day_tin',
      ten: 'Thông báo đẩy: khách nhắn',
      pha: 'hoi',
      loai_dich: 'ung_dung',
      bat: mt.firebase,
      ly_do_tat: mt.firebase ? null : 'Máy chủ chưa cấu hình Firebase',
      khi_nao: 'Mỗi tin khách nhắn vào ⇒ đẩy thông báo tới điện thoại NV được xem hội thoại đó.',
      nguon_ma: 'backend/src/modules/push/push-service.ts (notifyNewInboundMessage)',
      chinh_o: null,
      dich: [{ ten: 'App điện thoại của NV', loai: 'ung_dung', bat: mt.firebase }],
      ghi_chu: null,
      dan_toi: [],
    },
    {
      id: 'crm_su_kien_in',
      ten: 'Sự kiện & sự cố máy in',
      pha: 'in',
      loai_dich: 'bot',
      bat: du.soMayIn > 0,
      ly_do_tat: du.soMayIn > 0 ? null : 'Tổ chức chưa có máy in nào',
      khi_nao: 'Lệnh in đổi trạng thái / máy báo hết giấy, kẹt, mở nắp ⇒ CRM GHI SỔ (print_su_kien, print_su_co). CRM không tự nhắn ai — bot đọc sổ rồi báo theo luật của bot.',
      nguon_ma: 'backend/src/modules/ai/may-in/su-kien-in.ts (ghiSuCoIn) + trigger print_jobs_su_kien_*',
      chinh_o: '/settings/crm/print-agents',
      dich: [{ ten: `Bot đọc sổ (${du.soMayIn} máy in)`, loai: 'bot', bat: du.soMayIn > 0 }],
      ghi_chu: null,
      dan_toi: [{ den: 'nguon_may_in', vi_sao: 'CRM ghi sổ sự kiện in ⇒ bot đọc thành nguồn "Máy in"' }],
    },
  ];
  return muc;
}

/** Đọc + dựng cho MỘT org. Mọi truy vấn lọc theo orgId. */
export async function docCrmTuDong(orgId: string, env: NodeJS.ProcessEnv = process.env): Promise<{ crm: MucCrmTuDong[] }> {
  const [aiConfig, dichBao, org, soNguoiNhanSanSang, soNhomChanChao, soMayIn] = await Promise.all([
    prisma.aiConfig.findUnique({ where: { orgId }, select: { agentKhachEnabled: true, autoReplyEnabled: true } }),
    prisma.agentNotifyTarget.findMany({
      where: { orgId },
      select: { tenGoi: true, loaiDich: true, nhanKhachCanHoTro: true, nhanBotSuCo: true, enabled: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        appointmentZaloReminderEnabled: true, appointmentReminderOffsetsHours: true, systemNotifyZaloAccountId: true,
        systemNotifyNick: { select: { status: true } },
      },
    }),
    prisma.systemNotifyRecipient.count({ where: { orgId, status: 'ready' } }),
    prisma.conversation.count({ where: { orgId, botGroupBlocked: true } }),
    prisma.printAgent.count({ where: { orgId } }),
  ]);
  const du: DuLieuCrm = {
    aiConfig,
    dichBao,
    org: org ? {
      appointmentZaloReminderEnabled: org.appointmentZaloReminderEnabled,
      appointmentReminderOffsetsHours: org.appointmentReminderOffsetsHours,
      coNickHeThong: !!org.systemNotifyZaloAccountId,
      nickHeThongKetNoi: org.systemNotifyNick?.status === 'connected',
    } : null,
    soNguoiNhanSanSang,
    soNhomChanChao,
    soMayIn,
    aiKhachBoQua: demAiKhachBoQua(orgId),
  };
  return { crm: dungCrmTuDong(du, docMoiTruong(env)) };
}
