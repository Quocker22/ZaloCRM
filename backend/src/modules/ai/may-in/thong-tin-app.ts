// SPDX-License-Identifier: AGPL-3.0-or-later
// thong-tin-app.ts — đọc event socket `thong-tin-app` của app máy in (print-agent-rs) + câu nhật ký
// về CÁCH máy in nối với máy tính (USB / mạng LAN / chia sẻ). Hàm THUẦN — agent-ws.ts gọi, test
// không cần socket.
//
// Hợp đồng event (app gửi lúc nối, và GỬI LẠI mỗi khi thông tin kết nối đổi — vd máy in bắt đầu
// trả lời). Năm trường cũ (app ≤ 0.2.7) vẫn nhận nguyên như trước; trường mới (app ≥ 0.2.8) tuỳ chọn:
//   phienBan, mayIn, khay, khoGiay, may          — chữ (cũ)
//   ketNoi: {
//     loai:      'usb' | 'wsd' | 'tcpip' | 'ipp' | 'chia_se' | 'khac'
//     laMang:    boolean                         — true với wsd / tcpip / ipp
//     cong:      chữ ≤ 120                       — tên cổng Windows: "USB001", "WSD-3f2a…", "IP_192.168.1.23"
//     ip:        chữ ≤ 64 | null                 — IP/host máy in nếu biết
//     nguonIp:   'cau_hinh' | 'ten_cong' | 'registry' | 'location' | 'pnpx' | null
//     mayTraLoi: chữ ≤ 80 | null                 — "sẵn sàng (IPP)", "không trả lời"; null = chưa hỏi
//     moTa:      chữ ≤ 200                       — câu tiếng Việt dựng sẵn để hiện
//   }
//   heDieuHanh: chữ ≤ 80                         — "Windows 7 SP1 (6.1.7601)"
//   banBuild:   'win7' | 'thuong'
//
// LUẬT: dữ liệu từ mạng không tin mù — chữ đi qua `lamSach` (che token + cắt độ dài, agent-ws
// chuTuApp); mã liệt kê ngoài danh sách → null; `laMang` phải là boolean THẬT (không nhận "true",
// 1…); khoá lạ bị bỏ (dựng object mới, không spread payload).

export const LOAI_KET_NOI = ['usb', 'wsd', 'tcpip', 'ipp', 'chia_se', 'khac'] as const;
export type LoaiKetNoi = (typeof LOAI_KET_NOI)[number];

export const NGUON_IP = ['cau_hinh', 'ten_cong', 'registry', 'location', 'pnpx'] as const;
export type NguonIp = (typeof NGUON_IP)[number];

export const BAN_BUILD = ['win7', 'thuong'] as const;
export type BanBuild = (typeof BAN_BUILD)[number];

/** Trần độ dài từng trường chữ (ký tự). */
export const TRAN_CHU_THONG_TIN = {
  phienBan: 40, mayIn: 200, khay: 40, khoGiay: 40, may: 100,
  cong: 120, ip: 64, mayTraLoi: 80, moTa: 200, heDieuHanh: 80,
} as const;

export interface KetNoiMayIn {
  loai: LoaiKetNoi | null;
  laMang: boolean | null;
  cong: string | null;
  ip: string | null;
  nguonIp: NguonIp | null;
  mayTraLoi: string | null;
  moTa: string | null;
}

export interface ThongTinApp {
  phienBan: string | null;
  mayIn: string | null;
  khay: string | null;
  khoGiay: string | null;
  may: string | null;
  /** null = app cũ (không gửi) / không đọc được. */
  ketNoi: KetNoiMayIn | null;
  heDieuHanh: string | null;
  banBuild: BanBuild | null;
}

/** Làm sạch một giá trị chữ từ app: che token + cắt `tran` ký tự; rỗng → null. */
export type LamSach = (x: unknown, tran: number) => string | null;

function trongDs<T extends string>(ds: readonly T[], x: unknown): T | null {
  return typeof x === 'string' && (ds as readonly string[]).includes(x) ? (x as T) : null;
}

/** Object thường (không mảng, không null) — còn lại coi như vắng. */
function laObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

/** `ketNoi` của payload → bản đã làm sạch; vắng / sai kiểu / không có gì dùng được → null. */
export function docKetNoi(x: unknown, lamSach: LamSach): KetNoiMayIn | null {
  if (!laObject(x)) return null;
  const T = TRAN_CHU_THONG_TIN;
  const k: KetNoiMayIn = {
    loai: trongDs(LOAI_KET_NOI, x.loai),
    laMang: typeof x.laMang === 'boolean' ? x.laMang : null,
    cong: lamSach(x.cong, T.cong),
    ip: lamSach(x.ip, T.ip),
    nguonIp: trongDs(NGUON_IP, x.nguonIp),
    mayTraLoi: lamSach(x.mayTraLoi, T.mayTraLoi),
    moTa: lamSach(x.moTa, T.moTa),
  };
  const coGi = k.loai || k.cong || k.ip || k.mayTraLoi || k.moTa;
  return coGi ? k : null;
}

/** Toàn bộ payload `thong-tin-app` → bản đã làm sạch (5 trường cũ giữ nguyên cách đọc). */
export function docThongTinApp(tt: unknown, lamSach: LamSach): ThongTinApp {
  const o = laObject(tt) ? tt : {};
  const T = TRAN_CHU_THONG_TIN;
  return {
    phienBan: lamSach(o.phienBan, T.phienBan),
    mayIn: lamSach(o.mayIn, T.mayIn),
    khay: lamSach(o.khay, T.khay),
    khoGiay: lamSach(o.khoGiay, T.khoGiay),
    may: lamSach(o.may, T.may),
    ketNoi: docKetNoi(o.ketNoi, lamSach),
    heDieuHanh: lamSach(o.heDieuHanh, T.heDieuHanh),
    banBuild: trongDs(BAN_BUILD, o.banBuild),
  };
}

/**
 * Khoá so "kết nối đã đổi chưa" — CHỈ loai / ip / mayTraLoi (moTa/cong đổi chữ không đáng một
 * dòng nhật ký). Không biết gì → chuỗi rỗng.
 */
export function khoaKetNoi(k: KetNoiMayIn | null | undefined): string {
  return k ? `${k.loai ?? ''}|${k.ip ?? ''}|${k.mayTraLoi ?? ''}` : '';
}

const NHAN_MANG: Partial<Record<LoaiKetNoi, string>> = { wsd: 'WSD', tcpip: 'TCP/IP', ipp: 'IPP' };

/**
 * Câu mô tả kết nối để ghi/hiện: `moTa` app dựng sẵn; app không gửi `moTa` thì dựng tối thiểu
 * từ loai/ip/cổng. Không biết gì → null.
 */
export function moTaKetNoi(k: KetNoiMayIn | null | undefined): string | null {
  if (!k) return null;
  if (k.moTa) return k.moTa;
  if (k.loai === 'usb') return k.cong ? `USB (${k.cong})` : 'USB';
  if (k.loai === 'chia_se') return 'Máy in chia sẻ';
  if (k.loai && NHAN_MANG[k.loai]) return [`Mạng LAN (${NHAN_MANG[k.loai]})`, k.ip, k.mayTraLoi].filter(Boolean).join(' · ');
  return k.cong ? `Cổng ${k.cong}` : null;
}

/**
 * Phần trong ngoặc của dòng `app_ket_noi`: máy in, máy tính, phiên bản app, kết nối, hệ điều hành.
 * Vd `máy in "HP 4003", máy tính KHO-HN, app v0.2.8, Mạng LAN (WSD) · 192.168.1.23, Windows 7 SP1`.
 * App cũ (5 trường) → đúng như trước: chỉ ba mục đầu.
 */
export function moTaKetNoiApp(tt: ThongTinApp | null): string {
  if (!tt) return '';
  return [
    tt.mayIn && `máy in "${tt.mayIn}"`,
    tt.may && `máy tính ${tt.may}`,
    tt.phienBan && `app v${tt.phienBan}`,
    moTaKetNoi(tt.ketNoi),
    tt.heDieuHanh,
  ].filter(Boolean).join(', ');
}

/** Câu dòng `app_ket_noi_doi`: `Kết nối máy in "HP 4003" đổi: <mới> (trước: <cũ>)`. */
export function cauDoiKetNoi(moi: KetNoiMayIn | null, cu: KetNoiMayIn | null, mayIn: string | null): string {
  const ten = mayIn ? ` "${mayIn}"` : '';
  return `Kết nối máy in${ten} đổi: ${moTaKetNoi(moi) ?? 'chưa rõ'} (trước: ${moTaKetNoi(cu) ?? 'chưa rõ'})`;
}

/** `chiTiet` của dòng nhật ký — trường mới CHỈ khi có (app cũ ghi đúng như trước). */
export function chiTietThongTinApp(tt: ThongTinApp): Record<string, unknown> {
  const { ketNoi, heDieuHanh, banBuild, ...cu } = tt;
  return {
    ...cu,
    ...(ketNoi ? { ketNoi } : {}),
    ...(heDieuHanh ? { heDieuHanh } : {}),
    ...(banBuild ? { banBuild } : {}),
  };
}
