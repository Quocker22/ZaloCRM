// SPDX-License-Identifier: AGPL-3.0-or-later
// Bộ gửi snapshot `hang-doi` cho MỘT socket app máy in (hợp đồng hàng đợi/huỷ v5.1 §8.7).
//
// Server → app `hang-doi` { choIn, chuaXacNhan, capNhat } — CHỈ job của máy đó. Gửi: ngay sau
// `cau-hinh`; mỗi nhịp cron; sau mỗi thay đổi trong tiến trình (huỷ, bỏ theo dõi, claim, kết
// quả, tạm giữ/tiếp tục). Hai luật chống ồn:
//   - CHỈ gửi khi nội dung đổi so với lần gửi trước cho socket đó (so chuỗi JSON đã sắp khoá,
//     KHÔNG tính `capNhat` của phong bì — nó đổi mỗi lần dựng);
//   - tối đa 1 lần/giây: yêu cầu dồn dập (một lượt cron claim 10 job) gộp thành MỘT lần dựng.
// App hỏi lại (`lay-hang-doi`) thì bỏ qua so trùng — vẫn trong giới hạn 1 lần/giây (mỗi lần
// dựng là một truy vấn DB; app lỗi gửi dồn không được biến thành trận truy vấn).
//
// Tách khỏi agent-ws để test được bằng đồng hồ giả, không cần socket.
import type { HangDoiIn } from './huy-lenh-in.js';

export const MS_GUI_HANG_DOI_TOI_THIEU = 1000;

/** JSON với khoá object SẮP XẾP (mảng giữ thứ tự) — hai snapshot cùng nội dung ra cùng chuỗi. */
export function jsonSapXep(x: unknown): string {
  return JSON.stringify(x, (_k, v: unknown) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  });
}

export interface BoGuiHangDoi {
  /** Xin gửi snapshot. `boQuaSoTrung` = gửi kể cả khi nội dung không đổi (app vừa hỏi / vừa nối). */
  yeuCau(tuy?: { boQuaSoTrung?: boolean }): void;
  /** Socket đã ngắt — huỷ hẹn giờ, không gửi gì nữa. */
  dung(): void;
}

export function taoBoGuiHangDoi(o: {
  lay: () => Promise<HangDoiIn>;
  gui: (hd: HangDoiIn) => void;
  msToiThieu?: number;
  bayGio?: () => number;
  /** Dựng snapshot lỗi (DB chập chờn) — không bao giờ ném ra socket. */
  onLoi?: (err: unknown) => void;
}): BoGuiHangDoi {
  const ms = o.msToiThieu ?? MS_GUI_HANG_DOI_TOI_THIEU;
  const bayGio = o.bayGio ?? Date.now;
  let lanDungCuoi = -Infinity;
  let henGio: ReturnType<typeof setTimeout> | null = null;
  let dangDung = false;
  let canLai = false;
  let choBoQua = false;
  let daDung = false;
  let chuoiCuoi: string | null = null;

  async function chay(): Promise<void> {
    henGio = null;
    if (daDung) return;
    dangDung = true;
    const boQua = choBoQua;
    choBoQua = false;
    lanDungCuoi = bayGio();
    try {
      const hd = await o.lay();
      if (daDung) return;
      const chuoi = jsonSapXep({ choIn: hd.choIn, chuaXacNhan: hd.chuaXacNhan });
      if (boQua || chuoi !== chuoiCuoi) {
        chuoiCuoi = chuoi;
        o.gui(hd);
      }
    } catch (err) {
      try {
        o.onLoi?.(err);
      } catch {
        /* bỏ qua */
      }
    } finally {
      dangDung = false;
      if (canLai && !daDung) {
        canLai = false;
        yeuCau();
      }
    }
  }

  function yeuCau(tuy: { boQuaSoTrung?: boolean } = {}): void {
    if (daDung) return;
    if (tuy.boQuaSoTrung) choBoQua = true;
    if (dangDung) {
      canLai = true; // thay đổi tới giữa lúc đang dựng — dựng lại một lần sau khi xong
      return;
    }
    if (henGio) return; // đã hẹn — gộp
    const cho = lanDungCuoi + ms - bayGio();
    if (cho <= 0) {
      void chay();
      return;
    }
    henGio = setTimeout(() => void chay(), cho);
    (henGio as { unref?: () => void }).unref?.();
  }

  return {
    yeuCau,
    dung() {
      daDung = true;
      if (henGio) clearTimeout(henGio);
      henGio = null;
    },
  };
}
