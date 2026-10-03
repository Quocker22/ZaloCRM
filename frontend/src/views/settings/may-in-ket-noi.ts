// SPDX-License-Identifier: AGPL-3.0-or-later
// may-in-ket-noi.ts — hàm THUẦN cho dòng "máy in nối kiểu gì" trên thẻ mỗi máy (PrintAgentsPage.vue):
//   USB        → "🔌 USB"
//   mạng LAN   → "🌐 <moTa>"  (vd "🌐 Mạng LAN (WSD) · 192.168.1.23 · máy báo sẵn sàng")
//   chia sẻ    → "Máy in chia sẻ"
//   không biết / app offline / app cũ → không hiện gì
// và dòng "Máy tính" (hệ điều hành + phiên bản app). Dữ liệu: GET /may-in-agents (backend
// print-agent-service.ts ← thong-tin-app.ts, app ≥ 0.2.8).
//
// Không đụng Vue/DOM/axios để test được bằng vitest môi trường node (may-in-ket-noi.spec.ts).
import type { KetNoiMayIn, MayIn } from '@/api/print-agents';

export interface DongKetNoi {
  /** Để tô màu dòng. */
  kieu: 'usb' | 'mang' | 'chia_se';
  /** Chữ hiện trên thẻ (kèm biểu tượng ở đầu). */
  chu: string;
  /** Tooltip: cổng Windows, IP lấy từ đâu. */
  tieuDe: string;
}

const NHAN_MANG: Record<string, string> = { wsd: 'WSD', tcpip: 'TCP/IP', ipp: 'IPP' };

const NHAN_NGUON_IP: Record<string, string> = {
  cau_hinh: 'cấu hình cổng',
  ten_cong: 'tên cổng',
  registry: 'registry Windows',
  location: 'vị trí máy in',
  pnpx: 'PnP-X (WSD)',
};

function chiTietCong(k: KetNoiMayIn): string {
  return [
    k.cong && `Cổng Windows: ${k.cong}`,
    k.ip && k.nguonIp && `IP lấy từ ${NHAN_NGUON_IP[k.nguonIp] ?? k.nguonIp}`,
  ].filter(Boolean).join(' · ');
}

/** Dòng kết nối của một máy; null = không hiện gì (offline, app cũ, không rõ loại). */
export function dongKetNoi(m: Pick<MayIn, 'online' | 'ketNoi'>): DongKetNoi | null {
  const k = m.ketNoi;
  if (!m.online || !k) return null;
  if (k.loai === 'usb') {
    return { kieu: 'usb', chu: '🔌 USB', tieuDe: chiTietCong(k) || 'Máy in cắm USB vào máy tính' };
  }
  if (k.loai === 'chia_se') {
    return { kieu: 'chia_se', chu: 'Máy in chia sẻ', tieuDe: chiTietCong(k) || 'Máy in chia sẻ qua máy tính khác' };
  }
  if (k.laMang === true) {
    const tuDung = [`Mạng LAN${k.loai && NHAN_MANG[k.loai] ? ` (${NHAN_MANG[k.loai]})` : ''}`, k.ip, k.mayTraLoi]
      .filter(Boolean)
      .join(' · ');
    return { kieu: 'mang', chu: `🌐 ${k.moTa || tuDung}`, tieuDe: chiTietCong(k) || 'Máy in nối qua mạng LAN' };
  }
  return null;
}

/** "Windows 7 SP1 (6.1.7601) · app v0.2.8 · bản Win7" — null khi offline hoặc không biết gì. */
export function dongMayTinh(m: Pick<MayIn, 'online' | 'heDieuHanh' | 'phienBan' | 'banBuild'>): string | null {
  if (!m.online) return null;
  const phan = [
    m.heDieuHanh,
    m.phienBan && `app v${m.phienBan}`,
    m.banBuild === 'win7' ? 'bản Win7' : null,
  ].filter(Boolean);
  return phan.length ? phan.join(' · ') : null;
}
