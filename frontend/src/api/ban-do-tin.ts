// SPDX-License-Identifier: AGPL-3.0-or-later
// ban-do-tin.ts — client trang Cài đặt › Hệ thống › "Bản đồ tin" (docs/78 §3 C2–C3).
//
// Trang CHỈ nói chuyện qua interface `BanDoTinClient`. Hai adapter:
//   - `taoClientMau()` (views/settings/ban-do-tin/client-mau.ts): giả lập, mặc định tới khi backend xong;
//   - `taoClientHttp()`: nối backend nhánh feat/ban-do-tin. Đường dẫn dưới đây là DỰ KIẾN theo docs/78 C2 —
//     chỉnh lại cho khớp route thật khi backend chốt (một chỗ duy nhất).
//       GET    /bot-thong-bao/ban-do            -> AnhChupBanDo  (danh mục + luật + số đếm 7 ngày + nhật ký)
//       PUT    /bot-thong-bao/luat/:loai        {dich, che_do, phien_ban, ly_do?} -> { luat, nhat_ky }
//       DELETE /bot-thong-bao/luat/:loai        -> { nhat_ky }   (về như mã)
//       POST   /bot-thong-bao/luat/:loai/gui-thu {dich} -> { ok }
// Bật adapter thật: VITE_BAN_DO_TIN_API=that.
import { api } from '@/api/index';
import type { AnhChupBanDo, CheDo, DongNhatKy, Luat, MaDich } from '@/views/settings/ban-do-tin/kieu';
import { taoClientMau } from '@/views/settings/ban-do-tin/client-mau';

export interface LuuLuatNhap {
  loai: string;
  dich: MaDich[];
  che_do: CheDo;
  phien_ban?: number;
  ly_do?: string;
}

export interface BanDoTinClient {
  /** true với adapter giả lập — trang hiện nhãn "Dữ liệu mẫu". */
  laMau: boolean;
  /** Gửi thử chỉ bật khi backend có route. */
  coGuiThu: boolean;
  layAnhChup(): Promise<AnhChupBanDo>;
  luuLuat(nhap: LuuLuatNhap): Promise<{ luat: Luat; nhat_ky: DongNhatKy }>;
  xoaLuat(loai: string): Promise<DongNhatKy | null>;
  guiThu(loai: string, dich: MaDich[]): Promise<void>;
}

const loiTuApi = (e: unknown): Error => {
  const r = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
  return new Error(r || (e instanceof Error ? e.message : 'Lỗi không rõ'));
};

export function taoClientHttp(): BanDoTinClient {
  return {
    laMau: false,
    coGuiThu: true,
    async layAnhChup() {
      try { return (await api.get('/bot-thong-bao/ban-do')).data as AnhChupBanDo; } catch (e) { throw loiTuApi(e); }
    },
    async luuLuat(n) {
      try {
        return (await api.put(`/bot-thong-bao/luat/${encodeURIComponent(n.loai)}`, { dich: n.dich, che_do: n.che_do, phien_ban: n.phien_ban, ly_do: n.ly_do })).data;
      } catch (e) { throw loiTuApi(e); }
    },
    async xoaLuat(loai) {
      try { return (await api.delete(`/bot-thong-bao/luat/${encodeURIComponent(loai)}`)).data?.nhat_ky ?? null; } catch (e) { throw loiTuApi(e); }
    },
    async guiThu(loai, dich) {
      try { await api.post(`/bot-thong-bao/luat/${encodeURIComponent(loai)}/gui-thu`, { dich }); } catch (e) { throw loiTuApi(e); }
    },
  };
}

export function taoClientBanDoTin(): BanDoTinClient {
  return import.meta.env.VITE_BAN_DO_TIN_API === 'that' ? taoClientHttp() : taoClientMau();
}
