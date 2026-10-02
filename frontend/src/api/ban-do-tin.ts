// SPDX-License-Identifier: AGPL-3.0-or-later
// ban-do-tin.ts — client trang Cài đặt › Hệ thống › "Bản đồ tin" (docs/78 §3 C2–C3).
//
// Khớp backend `backend/src/modules/bot-quyen/bot-thong-bao-routes.ts` + `bot-crm-tu-dong.ts` (mount /bot-quyen, JWT,
// CHỈ owner/admin — người khác 403 CHI_ADMIN). Hình dữ liệu: views/settings/ban-do-tin/hop-dong.ts.
//   GET    /bot-quyen/ban-do-tin                -> { banDo: BanDoApi | null }         (null = bot chưa gửi ảnh chụp)
//   GET    /bot-quyen/ban-do-tin/crm-tu-dong    -> { crm: MucCrmApi[] }               (chỉ đọc)
//   GET    /bot-quyen/luat-thong-bao            -> { luat, banDo, canhBao }
//   POST   /bot-quyen/luat-thong-bao            {loai, dich?, cheDo?, lyDo?} -> 201 { luat }   (CRM mặc định cheDo=bong)
//   PUT    /bot-quyen/luat-thong-bao/:id        {phienBan (BẮT BUỘC), dich?, cheDo?, lyDo?} -> { luat: LuatApi & {doi} }
//                                               (thiếu phienBan ⇒ 400 PHIEN_BAN_THIEU; cũ ⇒ 409 PHIEN_BAN_CU)
//   DELETE /bot-quyen/luat-thong-bao/:id        body {lyDo?} -> { ok }
//   GET    /bot-quyen/nhan-vien                 -> { nhanVien } (chọn đích "Một NV chỉ định" — đích nv mang zalo_uid)
// Lỗi: { error: <câu tiếng Việt>, code: <MÃ> } — trang hiện NGUYÊN VĂN `error` (LoiBanDoTin).
//
// Trang luôn dùng adapter HTTP thật. Giả lập (`views/settings/ban-do-tin/client-mau.ts`) chỉ cho test + khung so ảnh
// (visual/ban-do-tin/xem.ts truyền vào qua prop `client`) — không import ở đây để không lọt vào bản dựng.
import { api } from '@/api/index';
import { loiTuApi } from '@/views/settings/ban-do-tin/loi';
import type {
  BanDoApi, CheDoApi, DanhSachLuatApi, DichLuatApi, LuatApi, MucCrmApi,
} from '@/views/settings/ban-do-tin/hop-dong';

export interface TaoLuatNhap {
  loai: string;
  dich: DichLuatApi[];
  /** bỏ trống ⇒ CRM đặt `bong` */
  cheDo?: CheDoApi;
  lyDo?: string;
}

export interface SuaLuatNhap {
  /** phiên bản luật đang xem — bắt buộc (chống ghi đè mù) */
  phienBan: number;
  dich?: DichLuatApi[];
  cheDo?: CheDoApi;
  lyDo?: string;
}

/** NV bot chọn làm đích `nv` (zalo_uid lúc gán — CRM kiểm uid có trong org). */
export interface NvDich {
  zaloUid: string;
  tenGoi: string;
  trangThai: string;
}

export interface BanDoTinClient {
  /** true với adapter giả lập — trang hiện nhãn "Dữ liệu mẫu". */
  laMau: boolean;
  layBanDo(): Promise<BanDoApi | null>;
  layLuat(): Promise<DanhSachLuatApi>;
  layCrmTuDong(): Promise<MucCrmApi[]>;
  taoLuat(n: TaoLuatNhap): Promise<LuatApi>;
  suaLuat(id: string, n: SuaLuatNhap): Promise<LuatApi & { doi?: boolean }>;
  xoaLuat(id: string, lyDo?: string): Promise<void>;
  layNhanVien(): Promise<NvDich[]>;
}

export { LoiBanDoTin, loiTuApi } from '@/views/settings/ban-do-tin/loi';

const CAU_HINH = { boQuaToast403: true } as const;

async function goi<T>(f: () => Promise<{ data: T }>): Promise<T> {
  try { return (await f()).data; } catch (e) { throw loiTuApi(e); }
}

export function taoClientHttp(): BanDoTinClient {
  return {
    laMau: false,
    async layBanDo() {
      const d = await goi<{ banDo: BanDoApi | null }>(() => api.get('/bot-quyen/ban-do-tin', CAU_HINH));
      return d?.banDo ?? null;
    },
    async layLuat() {
      const d = await goi<DanhSachLuatApi>(() => api.get('/bot-quyen/luat-thong-bao', CAU_HINH));
      return { luat: d?.luat ?? [], banDo: d?.banDo ?? null, canhBao: d?.canhBao ?? [] };
    },
    async layCrmTuDong() {
      const d = await goi<{ crm: MucCrmApi[] }>(() => api.get('/bot-quyen/ban-do-tin/crm-tu-dong', CAU_HINH));
      return d?.crm ?? [];
    },
    async taoLuat(n) {
      const body: Record<string, unknown> = { loai: n.loai, dich: n.dich };
      if (n.cheDo) body.cheDo = n.cheDo;
      if (n.lyDo) body.lyDo = n.lyDo;
      return (await goi<{ luat: LuatApi }>(() => api.post('/bot-quyen/luat-thong-bao', body, CAU_HINH))).luat;
    },
    async suaLuat(id, n) {
      const body: Record<string, unknown> = { phienBan: n.phienBan };
      if (n.dich) body.dich = n.dich;
      if (n.cheDo) body.cheDo = n.cheDo;
      if (n.lyDo) body.lyDo = n.lyDo;
      return (await goi<{ luat: LuatApi & { doi?: boolean } }>(
        () => api.put(`/bot-quyen/luat-thong-bao/${encodeURIComponent(id)}`, body, CAU_HINH),
      )).luat;
    },
    async xoaLuat(id, lyDo) {
      await goi(() => api.delete(`/bot-quyen/luat-thong-bao/${encodeURIComponent(id)}`, { ...CAU_HINH, data: lyDo ? { lyDo } : {} }));
    },
    async layNhanVien() {
      const d = await goi<{ nhanVien: Array<{ zaloUid: string; tenGoi: string; trangThai: string }> }>(
        () => api.get('/bot-quyen/nhan-vien', CAU_HINH),
      );
      return (d?.nhanVien ?? []).map((n) => ({ zaloUid: n.zaloUid, tenGoi: n.tenGoi, trangThai: n.trangThai }));
    },
  };
}

export function taoClientBanDoTin(): BanDoTinClient {
  return taoClientHttp();
}
