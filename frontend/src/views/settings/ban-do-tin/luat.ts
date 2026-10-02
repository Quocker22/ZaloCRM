// SPDX-License-Identifier: AGPL-3.0-or-later
// luat.ts — kiểm luật đích PHÍA TRÌNH DUYỆT, tương đương rào phía server (docs/78 §1 "luật an toàn cứng", C2, P0-5).
// Server vẫn kiểm lại — đây chỉ để chặn sớm + giải thích cho người sửa.
import { DICH_CO_THE_THEM, TEN_DICH } from './cau-hinh';
import type { CheDo, Composer, MaDich } from './kieu';

export interface CanhBaoDich {
  /** chặn: không được tick */
  chan?: string;
  /** cảnh báo: được tick, hiện ghi chú */
  canh?: string;
}

const DOANH_SO = ['lãi', 'doanh số'];

/** Cảnh báo cho MỘT đích của MỘT composer (luật cứng: không giá/SĐT/tiền/lãi vào nhóm khách…). */
export function kiemDich(c: Pick<Composer, 'nhay_cam'>, dich: MaDich): CanhBaoDich | null {
  const n = c.nhay_cam;
  if (dich === 'g_khach' && n.length) return { chan: `Không được: tin có ${n.join(', ')} — luật cứng cấm vào nhóm khách.` };
  if (dich === 'g_khach') return { canh: 'Nhóm khách chỉ nhận tin công khai; bot sẽ dùng mẫu rút gọn.' };
  if (dich === 'g_sales' && n.some((v) => DOANH_SO.includes(v)))
    return { canh: `Tin có ${n.join(', ')}: theo quyết định 30/09 chỉ admin xem doanh số toàn công ty — bot sẽ chỉ gửi số của từng người.` };
  if (dich === 'g_kho' && n.includes('giá')) return { canh: 'Nhóm kho sẽ nhận bản che giá (chỉ mã đơn, tên gọn, kho).' };
  return null;
}

export interface KetQuaKiemLuat {
  hopLe: boolean;
  loi: string[];
  canh: string[];
}

/** Kiểm cả một luật (danh sách đích hiệu lực + chế độ) cho composer. */
export function kiemLuat(c: Composer, dich: MaDich[], cheDo: CheDo): KetQuaKiemLuat {
  const loi: string[] = [];
  const canh: string[] = [];
  if (c.kieu === 'khoa') loi.push(`🔒 ${c.ten}: đích cố định — ${c.ly_do_khoa ?? 'thuộc lượt chat'}`);
  if (!['tat', 'bong', 'bat'].includes(cheDo)) loi.push('Chế độ không hợp lệ.');
  const lap = dich.filter((d, i) => dich.indexOf(d) !== i);
  if (lap.length) loi.push(`Đích lặp: ${[...new Set(lap)].map(TEN_DICH).join(', ')}.`);
  for (const d of dich) {
    if (!DICH_CO_THE_THEM.includes(d) && !c.dich_goc.includes(d)) loi.push(`Đích không hợp lệ: ${TEN_DICH(d)}.`);
    const cb = kiemDich(c, d);
    if (cb?.chan) loi.push(cb.chan);
    if (cb?.canh) canh.push(`${TEN_DICH(d)}: ${cb.canh}`);
  }
  if (c.kieu === 'ban_sao') {
    const thieu = c.dich_goc.filter((d) => !dich.includes(d));
    if (thieu.length) loi.push(`Nơi gốc luôn giữ (${thieu.map(TEN_DICH).join(', ')}) — chỉ THÊM bản sao.`);
  }
  if (c.kieu === 'thuan' && !dich.length && cheDo !== 'tat') loi.push('Chưa có đích nào — chọn ít nhất một, hoặc đặt chế độ Tắt.');
  if (dich.includes('nv')) canh.push('Một NV chỉ định: chọn người ở trang Quyền bot trước khi bật.');
  return { hopLe: loi.length === 0, loi, canh };
}

/** Đích một ô có bị khoá trong panel không (🔒) + lý do. */
export function dichKhoa(c: Composer, d: MaDich): string | null {
  if (c.kieu === 'khoa') return c.ly_do_khoa ?? 'Thuộc lượt chat.';
  if (c.kieu === 'ban_sao' && c.dich_goc.includes(d)) return 'Nơi gốc luôn giữ — chỉ THÊM bản sao.';
  return null;
}
