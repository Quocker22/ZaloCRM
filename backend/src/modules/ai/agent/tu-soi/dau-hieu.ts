// SPDX-License-Identifier: AGPL-3.0-or-later
// DẤU HIỆU "BOT LÀM CHƯA ỔN" — đếm bằng CODE trên hội thoại đã nguội.
//
// Anh Quốc 18/08: "sau khi khách nhắn xong một cuộc hội thoại thì phải biết
// đọc lại đoạn đó tự nhận biết đúng sai rồi training lại".
//
// VÌ SAO CODE ĐẾM TRƯỚC, MODEL CHẤM SAU (bài học xuyên suốt dự án): dấu hiệu
// ở đây là thứ ĐẾM ĐƯỢC — người nhắc lại mấy lần, có câu gắt không, bot hỏi
// đi hỏi lại mấy lượt, bot có nhả rác kỹ thuật không. Model rẻ chấm điểm thì
// trôi nổi; code đếm thì tất định, rẻ, test khoá được. Model chỉ vào sau để
// DIỄN GIẢI "lẽ ra nên làm gì" — và chỉ khi code đã ngửi thấy mùi.
import { boDau } from '../../odoo/tools/tra-san-pham.js';

export interface TinSoi {
  id: string;
  vai: 'nguoi' | 'bot';
  noiDung: string;
  luc: Date;
}

export interface KetQuaDauHieu {
  /** Mã dấu hiệu để log/test — không phải câu chữ cho model. */
  dauHieu: string[];
  /** 0-10, càng thấp càng có vấn đề. Bắt đầu 10, mỗi dấu hiệu trừ. */
  diem: number;
  /** Có đáng gọi model đọc lại không. */
  dangSoiKy: boolean;
}

const CAU_GAT = [
  'sai roi', 'sai r', 'khong phai', 'ko phai', 'dau phai', 'nham roi',
  'sao lai', 'sao van', 'sao khong', 'noi may lan', 'noi mai',
  'lai quen', 'quen roi a', 'da bao roi', 'bao roi ma', 'noi roi ma',
  'chan qua', 'tu tung', 'lung tung', 'the ma cung',
];
const CAU_NHAC_LAI = ['van chua', 'chua thay', 'nhu tren', 'da noi o tren', 'trong hinh co', 'da gui roi', 'noi roi'];
const BOT_BO_TAY = [
  'em chua ho tro', 'ngoai pham vi', 'em khong co thong tin', 'em chua xu ly kip',
  'khong tim thay', 'em chua ro', 'em van chua khop', 'nho ke toan', 'chuyen nhan vien',
];
const RAC_KY_THUAT = ['id=', '__count', 'luu y:', 'cac cot dung duoc', 'traceback', 'undefined'];

const co = (s: string, ds: string[]): string | null => {
  const t = boDau(s);
  return ds.find((k) => t.includes(k)) ?? null;
};

/** Chấm một đoạn hội thoại. `tin` sắp CŨ → MỚI. */
export function chamDauHieu(tin: TinSoi[]): KetQuaDauHieu {
  const dauHieu: string[] = [];
  let diem = 10;
  const cuaNguoi = tin.filter((t) => t.vai === 'nguoi');
  const cuaBot = tin.filter((t) => t.vai === 'bot');

  if (cuaBot.some((t) => co(t.noiDung, RAC_KY_THUAT))) { dauHieu.push('rac_ky_thuat'); diem -= 4; }

  const gat = cuaNguoi.filter((t) => co(t.noiDung, CAU_GAT)).length;
  if (gat > 0) { dauHieu.push(`nguoi_gat_x${gat}`); diem -= Math.min(4, gat * 2); }

  if (cuaNguoi.some((t) => co(t.noiDung, CAU_NHAC_LAI))) { dauHieu.push('phai_nhac_lai'); diem -= 2; }

  const boTay = cuaBot.filter((t) => co(t.noiDung, BOT_BO_TAY)).length;
  if (boTay > 0) { dauHieu.push(`bot_bo_tay_x${boTay}`); diem -= Math.min(3, boTay); }

  const soHoi = cuaBot.filter((t) => /\?\s*$|ạ\?|giúp em|chọn giúp/i.test(t.noiDung)).length;
  if (soHoi >= 3) { dauHieu.push(`hoi_vong_x${soHoi}`); diem -= 2; }

  if (cuaNguoi.length > 12) { dauHieu.push('qua_dai'); diem -= 1; }

  const daThay = new Set<string>();
  for (const t of cuaBot) {
    const k = boDau(t.noiDung).slice(0, 120);
    if (k.length > 40 && daThay.has(k)) { dauHieu.push('bot_lap_nguyen_van'); diem -= 2; break; }
    daThay.add(k);
  }

  diem = Math.max(0, Math.min(10, diem));
  const dangSoiKy = diem <= 7 || dauHieu.some((d) => d.startsWith('rac_ky_thuat') || d.startsWith('nguoi_gat'));
  return { dauHieu, diem, dangSoiKy };
}
