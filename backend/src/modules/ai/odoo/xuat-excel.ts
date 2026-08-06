// SPDX-License-Identifier: AGPL-3.0-or-later
// XUẤT EXCEL — mảng dữ liệu → buffer .xlsx. KHÔNG biết gì về Odoo hay Zalo.
//
// Vì sao có (spec 06/08/2026): bảng dài — top 20 SP, công nợ 50 khách — nhét
// vào tin Zalo là không đọc nổi. Quá ngưỡng thì text chỉ tóm tắt, file đính
// kèm mang đủ dữ liệu.
//
// File LUÔN có kỳ dữ liệu + thời điểm xuất — mở ra là biết số liệu lúc nào,
// khỏi cãi nhau "số cũ hay mới".
import ExcelJS from 'exceljs';

/** Bảng dữ liệu chờ xuất. `dong` là mảng các hàng, mỗi hàng khớp thứ tự `cot`. */
export interface BangExcel {
  tieuDe: string;
  /** Kỳ dữ liệu, vd "01/08/2026 – 06/08/2026". Không có thì ghi "toàn bộ". */
  ky?: string;
  cot: string[];
  dong: Array<Array<string | number>>;
  /** Hàng tổng (đặt cuối, in đậm). Khớp thứ tự `cot`. */
  tongCong?: Array<string | number>;
}

/** Quá ngưỡng này thì text chỉ tóm tắt (tổng + top 5), file mang đủ. */
export const NGUONG_DINH_KEM = 15;

/**
 * Tệp báo cáo chờ gửi qua Zalo — caller quyết định gửi đi đâu.
 *
 * `loai`: 'anh' gửi qua guiAnh (PNG — mặc định, zca-js gửi ảnh ổn định);
 * 'file' gửi qua guiFile (xlsx — zca-js gửi file .xlsx hay rớt âm thầm, chỉ
 * dùng khi thật cần bản mở-sửa-được). Xem anh-bang.ts:bangRaAnh.
 */
export interface TepBaoCao {
  tenFile: string;
  duLieu: Buffer;
  loai: 'anh' | 'file';
  /** Một dòng mô tả gửi kèm, vd "Đầy đủ 47 dòng". */
  moTa: string;
}

export async function xuatExcel(bang: BangExcel): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Báo cáo');

  ws.addRow([bang.tieuDe]).font = { bold: true, size: 14 };
  ws.addRow([`Kỳ dữ liệu: ${bang.ky ?? 'toàn bộ'} · Xuất lúc: ${new Date().toLocaleString('vi-VN')}`]);
  ws.addRow([]);

  const header = ws.addRow(bang.cot);
  header.font = { bold: true };

  for (const d of bang.dong) ws.addRow(d);

  if (bang.tongCong) {
    const tong = ws.addRow(bang.tongCong);
    tong.font = { bold: true };
  }

  // Nới cột theo dữ liệu — file mở ra đọc được ngay, khỏi kéo tay từng cột.
  ws.columns.forEach((col, i) => {
    const daiNhat = Math.max(
      bang.cot[i]?.length ?? 0,
      ...bang.dong.map((d) => String(d[i] ?? '').length),
    );
    col.width = Math.min(Math.max(daiNhat + 2, 10), 50);
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Tên file an toàn: bỏ dấu + ký tự lạ, kèm ngày. */
export function tenFileBaoCao(tieuDe: string): string {
  const sach = tieuDe
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const ngay = new Date().toISOString().slice(0, 10);
  return `${sach || 'bao-cao'}-${ngay}.xlsx`;
}
