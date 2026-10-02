// SPDX-License-Identifier: AGPL-3.0-or-later
// luat.ts — chặn sớm + giải thích PHÍA TRÌNH DUYỆT cho luật đích (docs/78 §1 "luật an toàn cứng", C2, P0-5).
// Server (backend bot-thong-bao-luat.ts) kiểm lại MỌI thứ và câu lỗi của server hiện NGUYÊN VĂN — đây chỉ để không bấm
// được ô chắc chắn bị từ chối, và để giải thích.
import { DICH_LUAT, TEN_DICH, tenNhayCam } from './cau-hinh';
import type { CheDo, Composer, Luat, MaDich } from './kieu';

export interface CanhBaoDich {
  /** chặn: không được tick */
  chan?: string;
  /** cảnh báo: được tick, hiện ghi chú */
  canh?: string;
}

/** Cảnh báo cho MỘT hàng bản sao của MỘT composer. Luật cứng duy nhất CRM kiểm theo nhãn: nhạy cảm ⇒ cấm nhóm khách. */
export function kiemDich(c: Pick<Composer, 'nhay_cam'>, dich: MaDich): CanhBaoDich | null {
  const n = c.nhay_cam;
  if (dich === 'g_khach' && n.length) return { chan: `Không được: tin có ${tenNhayCam(n)} — luật cứng cấm vào nhóm khách.` };
  if (dich === 'g_khach') return { canh: 'Nhóm khách chỉ nhận tin công khai.' };
  if (dich === 'g_sales' && n.some((v) => v === 'lai' || v === 'doanh_so'))
    return { canh: `Tin có ${tenNhayCam(n)}: bot chặn doanh số toàn công ty khi đích không phải Admin — nhóm Sales không nhận phần đó.` };
  if (dich === 'g_kho' && n.includes('gia')) return { canh: 'Nhóm kho nhận bản che giá (chỉ mã đơn, tên gọn, kho).' };
  return null;
}

/** Hàng có trong danh sách tick của panel (theo thứ tự: nơi gốc, bản sao đang có, các hàng luật thêm được). */
export function dsDichPanel(c: Composer, banSao: readonly MaDich[]): MaDich[] {
  if (c.kieu === 'khoa') return [...c.dich_goc];
  return [...new Set<MaDich>([...c.dich_goc, ...banSao, ...DICH_LUAT])];
}

/** Một ô đích bị khoá trong panel (🔒) + lý do; null = tick được. */
export function dichKhoa(c: Composer, d: MaDich): string | null {
  if (c.kieu === 'khoa') return c.ly_do_khoa ? `Đích cố định: ${c.ly_do_khoa}` : 'Đích cố định — tin gắn với lượt chat (mã chốt, câu hỏi neo vào tin gốc). Không định tuyến được.';
  if (c.dich_goc.includes(d)) return 'Nơi gốc luôn nhận tin như mã — luật chỉ THÊM bản sao.';
  if (!DICH_LUAT.includes(d)) return `${TEN_DICH(d)}: CRM chưa có kiểu đích này cho luật.`;
  return null;
}

/**
 * Đổi chế độ bản sao được không (null = được). Luật MỚI luôn bắt đầu ở chạy bóng (CRM mặc định) — không nhảy thẳng sang
 * Bật khi chưa có luật, và không Bật một luật chưa có đích bản sao nào (bật mà không gửi thêm gì = nút nói dối).
 */
export function kiemCheDo(luat: Pick<Luat, 'dich'> | undefined, moi: CheDo): string | null {
  if (moi !== 'bat') return null;
  if (!luat) return 'Chưa có luật — tick một đích trước; luật mới bắt đầu ở Chạy bóng.';
  if (!luat.dich.length) return 'Chưa có đích bản sao nào để bật — tick một đích trước.';
  return null;
}
