// SPDX-License-Identifier: AGPL-3.0-or-later
// Lớp "CRM tự động" của Bản đồ tin (docs/78 C3) — phần THUẦN: bật/tắt + lý do + đích theo đúng thứ tự ưu tiên của mã gửi.
import { describe, it, expect } from 'vitest';
import { dungCrmTuDong, docMoiTruong, type DuLieuCrm, type MoiTruongCrm } from '../src/modules/bot-quyen/bot-crm-tu-dong.js';

const MT: MoiTruongCrm = { odooDu: true, threadBaoSaleEnv: false, handoffSaleEnv: false, firebase: false };
const DU: DuLieuCrm = {
  aiConfig: { agentKhachEnabled: true, autoReplyEnabled: false },
  dichBao: [],
  org: { appointmentZaloReminderEnabled: false, appointmentReminderOffsetsHours: [1, 3, 6], coNickHeThong: false, nickHeThongKetNoi: false },
  soNguoiNhanSanSang: 0,
  soNhomChanChao: 0,
  soMayIn: 0,
};
const muc = (du: Partial<DuLieuCrm> = {}, mt: Partial<MoiTruongCrm> = {}) =>
  Object.fromEntries(dungCrmTuDong({ ...DU, ...du }, { ...MT, ...mt }).map((m) => [m.id, m]));

describe('dungCrmTuDong', () => {
  it('id duy nhất, mỗi mục đủ trường, không lộ threadId/UID', () => {
    const ds = dungCrmTuDong({ ...DU, dichBao: [{ tenGoi: 'Nhóm trực', loaiDich: 'nhom', nhanKhachCanHoTro: true, nhanBotSuCo: true, enabled: true }] }, MT);
    expect(new Set(ds.map((m) => m.id)).size).toBe(ds.length);
    for (const m of ds) {
      expect(m.ten && m.pha && m.khi_nao && m.nguon_ma).toBeTruthy();
      expect(m.bat, m.id).toBe(m.ly_do_tat === null);
    }
    expect(JSON.stringify(ds)).not.toMatch(/thread_?id/i);
  });

  it('báo người trực: DB có đích bật ⇒ dùng DB, KHÔNG thêm env (không cộng dồn)', () => {
    const m = muc({ dichBao: [
      { tenGoi: 'Nhóm trực', loaiDich: 'nhom', nhanKhachCanHoTro: true, nhanBotSuCo: false, enabled: true },
      { tenGoi: 'Anh Quốc', loaiDich: 'ca_nhan', nhanKhachCanHoTro: true, nhanBotSuCo: true, enabled: false },
    ] }, { threadBaoSaleEnv: true });
    expect(m.crm_khach_can_ho_tro.bat).toBe(true);
    expect(m.crm_khach_can_ho_tro.dich).toEqual([
      { ten: 'Nhóm trực', loai: 'nhom', bat: true },
      { ten: 'Anh Quốc', loai: 'ca_nhan', bat: false },
    ]);
    // bot_su_co: chỉ có đích đã tắt ⇒ rơi về env (đúng dich-bao.ts)
    expect(m.crm_bot_su_co.dich.map((d) => d.ten)).toEqual(['Anh Quốc', 'Nhóm khai trong env AI_AGENT_THREAD_BAO_SALE (dự phòng)']);
    expect(m.crm_bot_su_co.ghi_chu).toMatch(/env/);
  });

  it('báo người trực: luồng khách tắt / thiếu Odoo / không đích ⇒ tắt kèm lý do', () => {
    expect(muc({ aiConfig: null }).crm_khach_can_ho_tro.ly_do_tat).toMatch(/Luồng bot tư vấn khách đang tắt/);
    expect(muc({}, { odooDu: false }).crm_bot_su_co.ly_do_tat).toMatch(/Odoo/);
    expect(muc().crm_khach_can_ho_tro.ly_do_tat).toMatch(/Chưa có nơi nhận/);
    expect(muc({}, { threadBaoSaleEnv: true }).crm_khach_can_ho_tro.bat).toBe(true);
  });

  it('lịch hẹn: cần bật nhắc Zalo + nick hệ thống kết nối; mốc nhắc cộng dồn theo cấu hình', () => {
    expect(muc().crm_lich_hen_tao.ly_do_tat).toMatch(/Nhắc lịch hẹn qua Zalo/);
    const org = { appointmentZaloReminderEnabled: true, appointmentReminderOffsetsHours: [2, 2], coNickHeThong: true, nickHeThongKetNoi: false };
    expect(muc({ org }).crm_lich_hen_nhac.ly_do_tat).toMatch(/mất kết nối/);
    const m = muc({ org: { ...org, nickHeThongKetNoi: true }, soNguoiNhanSanSang: 4 });
    expect(m.crm_lich_hen_tao.bat).toBe(true);
    expect(m.crm_lich_hen_nhac.khi_nao).toMatch(/2 \/ 4 giờ/);
    expect(m.crm_lich_hen_nhac.dich[0].ten).toMatch(/4 NV/);
    expect(m.crm_lich_hen_quan_ly.bat).toBe(false); // mã chết — không cron nào gọi
  });

  it('máy in: CRM chỉ ghi sổ cho bot (cạnh sang nguon_may_in); không máy ⇒ tắt', () => {
    expect(muc().crm_su_kien_in.bat).toBe(false);
    const m = muc({ soMayIn: 2 }).crm_su_kien_in;
    expect(m.bat).toBe(true);
    expect(m.loai_dich).toBe('bot');
    expect(m.dan_toi).toEqual([{ den: 'nguon_may_in', vi_sao: expect.any(String) }]);
  });

  it('chuyển sale cần RAG bật + env UID sale; đẩy tin cần Firebase', () => {
    expect(muc({ aiConfig: { agentKhachEnabled: false, autoReplyEnabled: true } }).crm_chuyen_sale.ly_do_tat).toMatch(/AI_HANDOFF/);
    expect(muc({ aiConfig: { agentKhachEnabled: false, autoReplyEnabled: true } }, { handoffSaleEnv: true }).crm_chuyen_sale.bat).toBe(true);
    expect(muc({}, { firebase: true }).crm_day_tin.bat).toBe(true);
  });

  it('trợ lý AI trả lời khách (docs/79 T6): hiện "im ở nhóm bot phụ trách" + số tin đã bỏ qua; bật theo tự trả lời', () => {
    const tat = muc().crm_tro_ly_khach;
    expect(tat.bat).toBe(false);
    expect(tat.ly_do_tat).toMatch(/Tự trả lời/);
    const m = muc({ aiConfig: { agentKhachEnabled: true, autoReplyEnabled: true }, aiKhachBoQua: { nhom_do_bot_phu_trach: 7, tra_cuu_loi: 2 } })
      .crm_tro_ly_khach;
    expect(m.bat).toBe(true);
    expect(m.ghi_chu).toMatch(/im ở nhóm bot phụ trách/i);
    expect(m.ghi_chu).toMatch(/7 tin/);
    expect(m.ghi_chu).toMatch(/2 tin/);
    expect(m.khi_nao).toMatch(/im ở nhóm bot phụ trách/i);
    expect(m.dich.some((d) => d.loai === 'nhom' && /im ở nhóm bot phụ trách/i.test(d.ten))).toBe(true);
    expect(m.nguon_ma).toMatch(/nhom-bot-phu-trach\.ts/);
    // chào nhóm + chuyển sale (RAG) cũng im ở nhóm bot phụ trách
    expect(muc().crm_chao_nhom.ghi_chu).toMatch(/im ở nhóm bot phụ trách/i);
    expect(muc().crm_chuyen_sale.ghi_chu).toMatch(/im ở nhóm bot phụ trách/i);
  });

  it('docMoiTruong đọc đúng env', () => {
    expect(docMoiTruong({ ODOO_URL: 'u', ODOO_DB: 'd', ODOO_USERNAME: 'n', ODOO_PASSWORD: 'p', FIREBASE_SERVICE_ACCOUNT_PATH: '/x' }))
      .toEqual({ odooDu: true, threadBaoSaleEnv: false, handoffSaleEnv: false, firebase: true });
    expect(docMoiTruong({ AI_HANDOFF_SALE_ZALO_UID: '  ' }).handoffSaleEnv).toBe(false);
  });
});
