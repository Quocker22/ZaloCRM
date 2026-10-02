// SPDX-License-Identifier: AGPL-3.0-or-later
// client-mau.ts — adapter GIẢ LẬP cho `BanDoTinClient`, CHỈ cho test + khung so ảnh (visual/ban-do-tin/xem.ts).
// Trả đúng hình hợp đồng (hop-dong.ts) và bắt chước rào của server (bot-thong-bao-luat.ts / -service.ts): composer lạ ⇒ 400,
// 🔒 ⇒ 400, nhom_goc ⇒ 400, nhạy cảm → nhóm khách ⇒ 400, trùng luật ⇒ 409 DA_CO_LUAT, thiếu/cũ phienBan ⇒ 400/409.
import type { BanDoTinClient, SuaLuatNhap, TaoLuatNhap } from '@/api/ban-do-tin';
import { LoiBanDoTin } from './loi';
import { banDoMau, crmMau, danhSachLuatMau, soGia } from './danh-muc-mau';
import type { BanDoApi, ComposerApi, DemApi, DichLuatApi, LuatApi } from './hop-dong';
import { dungAnhChup, hangTuDichLuat } from './chuyen-doi';
import type { AnhChupBanDo } from './kieu';

export interface TuyChonMau {
  /** trễ mỗi lời gọi (ms) */
  tre?: number;
  /** bot chưa gửi ảnh chụp ⇒ GET /ban-do-tin trả null */
  trong?: boolean;
  /** GET crm-tu-dong hỏng */
  loiCrm?: boolean;
}

/** Số đếm giả, tất định: gửi ở nơi gốc (7 ngày) + mỗi đích bản sao theo luật (bóng ⇒ ket_qua=bong, có cả 24h). */
export function demMau(composer: readonly ComposerApi[], luat: readonly LuatApi[]): DemApi[] {
  const ra: DemApi[] = [];
  const dong = (c: string, dk: string, luatId: string | null, kq: DemApi['ket_qua'], cs: DemApi['cua_so'], so: number) => {
    if (so > 0) ra.push({ khoa_canh: `${c}→${dk}|${luatId ?? 'goc'}`, composer: c, dich_kieu: dk, luat_id: luatId, ket_qua: kq, cua_so: cs, so });
  };
  for (const c of composer) {
    for (const d of c.dich_goc) {
      dong(c.id, d, null, 'da_gui', '7d', 5 + soGia(`${c.id}@${d}`, 300));
      dong(c.id, d, null, 'chan_tam_im', '7d', soGia(`c${c.id}@${d}`, 4));
    }
  }
  for (const l of luat) {
    if (l.cheDo === 'tat') continue;
    for (const d of l.dich) {
      const dk = hangTuDichLuat(d);
      if (!dk) continue;
      const so = 6 + soGia(`${l.id}${dk}`, 120);
      if (l.cheDo === 'bong') {
        dong(l.loai, dk, l.id, 'bong', '7d', so);
        dong(l.loai, dk, l.id, 'bong', '24h', Math.max(1, Math.round(so / 7)));
      } else {
        dong(l.loai, dk, l.id, 'da_gui', '7d', so);
        dong(l.loai, dk, l.id, 'da_gui', '24h', Math.max(1, Math.round(so / 7)));
      }
    }
  }
  return ra;
}

const NV_MAU = [
  { zaloUid: 'uid-nv-tien', tenGoi: 'Anh Tiến (kho HN)', trangThai: 'hoat_dong' },
  { zaloUid: 'uid-nv-lan', tenGoi: 'Chị Lan (kế toán)', trangThai: 'hoat_dong' },
];

const sai = (code: string, msg: string, status = 400) => new LoiBanDoTin(msg, status, code);

export function taoClientMau(tc: TuyChonMau | number = {}): BanDoTinClient {
  const o: TuyChonMau = typeof tc === 'number' ? { tre: tc } : tc;
  const goc: BanDoApi = banDoMau();
  let luat: LuatApi[] = danhSachLuatMau().luat;
  let stt = luat.length;
  const cho = () => (o.tre ? new Promise((r) => setTimeout(r, o.tre)) : Promise.resolve());

  function kiem(loai: string, dich: DichLuatApi[]) {
    const c = goc.composer.find((x) => x.id === loai);
    if (!c) throw sai('COMPOSER_LA', `Không có loại tin "${loai}" trong danh mục bot gửi lên`);
    if (c.kieu === 'khoa') throw sai('COMPOSER_KHOA', `Tin "${c.ten ?? c.id}" chỉ gửi ở nơi gốc (🔒) — không định tuyến được`);
    for (const d of dich) {
      if ((d.kieu as string) === 'nhom_goc') throw sai('DICH_NHOM_GOC', 'Nơi gốc luôn nhận tin — không thêm "nhóm gốc" làm đích bản sao (sẽ gửi đôi)');
      if (d.kieu === 'nv' && !NV_MAU.some((n) => n.zaloUid === d.gia_tri)) throw sai('NV_KHONG_CO', `Không có nhân viên bot với zalo_uid ${d.gia_tri} trong tổ chức`);
      if (d.kieu === 'chuc_nang' && d.gia_tri === 'khach' && c.nhay_cam.length) {
        throw sai('LO_DU_LIEU_NHOM_KHACH', `Tin "${c.ten ?? c.id}" có dữ liệu nhạy cảm (${c.nhay_cam.join(', ')}) — không gửi vào nhóm khách`);
      }
    }
  }

  return {
    laMau: true,
    async layBanDo() {
      await cho();
      if (o.trong) return null;
      return { ...goc, dem: demMau(goc.composer, luat) };
    },
    async layLuat() {
      await cho();
      return {
        luat: luat.map((l) => ({ ...l, dich: l.dich.map((d) => ({ ...d })) })),
        banDo: o.trong ? null : { phienBan: goc.phienBan, luc: goc.luc },
        canhBao: [],
      };
    },
    async layCrmTuDong() {
      await cho();
      if (o.loiCrm) throw new LoiBanDoTin('Lỗi máy chủ (HTTP 500)', 500, null);
      return crmMau();
    },
    async taoLuat(n: TaoLuatNhap) {
      await cho();
      if (o.trong) throw sai('CHUA_CO_BAN_DO', 'Bot chưa gửi danh mục tin (bản đồ tin) lên CRM nên chưa kiểm được luật — chưa sửa được luật thông báo. Chờ bot đồng bộ (≤ 5 phút) rồi thử lại.', 409);
      kiem(n.loai, n.dich);
      if (luat.some((l) => l.loai === n.loai)) throw sai('DA_CO_LUAT', `Loại tin "${n.loai}" đã có luật — sửa luật đó thay vì tạo mới`, 409);
      const moi: LuatApi = {
        id: `luat-${++stt}`, loai: n.loai, dich: n.dich.map((d) => ({ ...d })), cheDo: n.cheDo ?? 'bong', dieuKien: {},
        gomGiay: 0, lich: null, phienBan: 1, suaBoi: 'ban', suaLuc: new Date().toISOString(),
      };
      luat = [...luat, moi];
      return moi;
    },
    async suaLuat(id: string, n: SuaLuatNhap) {
      await cho();
      if (n.phienBan === undefined || n.phienBan === null) throw sai('PHIEN_BAN_THIEU', 'Thiếu phienBan (phiên bản luật đang xem) — tải lại rồi sửa');
      const cu = luat.find((l) => l.id === id);
      if (!cu) throw sai('KHONG_TIM_THAY', 'Không tìm thấy luật thông báo này', 404);
      if (cu.phienBan !== n.phienBan) throw sai('PHIEN_BAN_CU', 'Luật vừa được người khác sửa — tải lại rồi sửa tiếp', 409);
      const dich = n.dich ?? cu.dich;
      kiem(cu.loai, dich);
      const moi: LuatApi = { ...cu, dich: dich.map((d) => ({ ...d })), cheDo: n.cheDo ?? cu.cheDo, phienBan: cu.phienBan + 1, suaBoi: 'ban', suaLuc: new Date().toISOString() };
      luat = luat.map((l) => (l.id === id ? moi : l));
      return { ...moi, doi: true };
    },
    async layNhanVien() {
      await cho();
      return NV_MAU.map((n) => ({ ...n }));
    },
    async xoaLuat(id: string) {
      await cho();
      if (!luat.some((l) => l.id === id)) throw sai('KHONG_TIM_THAY', 'Không tìm thấy luật thông báo này', 404);
      luat = luat.filter((l) => l.id !== id);
    },
  };
}

/** Ảnh chụp mẫu đã dựng (đồng bộ) — cho test thuần: đi đúng đường hợp đồng → chuyen-doi như trang thật. */
export function anhChupMau(): AnhChupBanDo {
  const banDo = banDoMau();
  const ds = danhSachLuatMau();
  return dungAnhChup({ banDo: { ...banDo, dem: demMau(banDo.composer, ds.luat) }, luat: ds, crm: crmMau(), mau: true });
}
