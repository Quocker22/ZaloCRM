// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool: tra tri thức kỹ thuật từ tài liệu (datasheet, catalog).
//
// VÌ SAO TOOL NÀY TỒN TẠI: 12 tool hiện có đều đọc Odoo — giá, tồn, khách, đơn.
// Nhưng khách hỏi "đèn này bảo hành mấy năm", "IP mấy", "chạy nguồn bao nhiêu A"
// thì không bảng nào của Odoo trả lời được. Tri thức đó nằm trong datasheet.
// Hiện bot gặp câu này là `chuyen_sale`.
//
// KHÔNG DÙNG PATHWAY (đo thật 2026-08-02): parser của nó mất 8-15 phút cho 7
// file và CHẾT VÌ HẾT RAM với file 18MB, rồi vẫn liệt kê file đó nên nhìn như
// đã index. PyMuPDF làm cùng việc trong 1,17 giây. Hạ tầng tri thức
// (`knowledge_documents` + hybrid vector/lexical) đã có sẵn trong hệ.
//
// ⚠️ RANH GIỚI CỨNG — tool này KHÔNG trả lời câu hỏi về TIỀN.
// Giá đọc từ Odoo qua `tra_san_pham` là nguồn DUY NHẤT đúng. Để RAG trả lời câu
// về giá là tái tạo bug thật: KB cũ chứa giá → bot báo giảm 50% cho khách vì
// đọc giá từ tài liệu cũ. Chặn ở CODE, không chỉ trong prompt.

import type { ToolDefinition } from '../../agent/types.js';

/**
 * Từ khoá cho biết câu hỏi là về TIỀN/TỒN → phải dùng tool Odoo, không dùng RAG.
 *
 * Đã bỏ dấu để bắt cả khi nhân viên gõ không dấu.
 */
const TU_KHOA_TIEN = [
  'gia bao nhieu', 'bao nhieu tien', 'gia ban', 'gia si', 'gia le', 'don gia',
  'chiet khau', 'giam gia', 'con hang', 'ton kho', 'con bao nhieu', 'cong no',
  'doanh thu', 'gia von',
];

/**
 * Dấu hiệu GIÁ trong nội dung trả về — hàng rào THỨ HAI.
 *
 * VÌ SAO cần (bug thật 2026-08-02, ca TT-049): nhân viên hỏi "@bot giá vốn led
 * 3 bóng". Hàng rào thứ nhất soi CÂU HỎI, nhưng model diễn đạt lại thành
 * "thông số led 3 bóng" rồi mới gọi tool — chữ "giá vốn" biến mất, lọt qua.
 *
 * Nên phải soi cả ĐẦU RA: đoạn tài liệu nào có dấu hiệu giá thì bỏ, không đưa
 * cho model. Tài liệu có thể in giá từ năm ngoái.
 */
const DAU_HIEU_GIA = [
  /\bgiá\s*(bán|vốn|sỉ|lẻ|nhập)\b/i,
  /\bunit\s*price\b/i,
  /\bagent\s*price\b/i,
  /\bvip\s*price\b/i,
  /\bretail\s*price\b/i,
  /[\d.]{4,}\s*(đ|vnd|vnđ)\b/i,
];

/** Đoạn này có chứa giá không? */
export function doanCoGia(noiDung: string): boolean {
  return DAU_HIEU_GIA.some((re) => re.test(noiDung));
}

/** Số đoạn trả về. Nhiều hơn là tin Zalo quá dài, và tốn token mọi vòng sau. */
const SO_DOAN = 3;

/** Đoạn dài hơn ngưỡng này thì cắt — datasheet có bảng rất dài. */
const DAI_TOI_DA = 700;

export interface DoanTriThuc {
  tieuDe: string;
  noiDung: string;
  diem: number;
}

export type KetQuaTriThuc =
  | { loai: 'ok'; doan: DoanTriThuc[] }
  | { loai: 'cau_hoi_ve_tien'; tuKhoa: string }
  | { loai: 'khong_thay'; cauHoi: string };

/** Bỏ dấu tiếng Việt để so khớp. */
export function boDau(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .trim();
}

/**
 * Câu hỏi này có phải về tiền/tồn không?
 *
 * Trả về từ khoá bắt được, hoặc null. Đây là HÀNG RÀO CỨNG — không phụ thuộc
 * model có đọc prompt hay không.
 */
export function laCauHoiVeTien(cauHoi: string): string | null {
  const s = boDau(cauHoi);
  return TU_KHOA_TIEN.find((k) => s.includes(k)) ?? null;
}

export interface TraTriThucDeps {
  /** Tìm đoạn liên quan. Dùng lại `searchKnowledge` sẵn có của hệ. */
  timDoan: (cauHoi: string, soDoan: number) => Promise<Array<{ content: string; score?: number }>>;
}

export async function traTriThuc(
  deps: TraTriThucDeps,
  input: { cau_hoi: string },
): Promise<KetQuaTriThuc> {
  const cauHoi = input.cau_hoi?.trim() ?? '';
  if (!cauHoi) return { loai: 'khong_thay', cauHoi: '' };

  // Chặn TRƯỚC khi tra — không tốn round-trip cho câu hỏi vốn phải đi Odoo.
  const tuTien = laCauHoiVeTien(cauHoi);
  if (tuTien) return { loai: 'cau_hoi_ve_tien', tuKhoa: tuTien };

  // Lấy dư rồi lọc — đoạn chứa giá bị bỏ, cần dự phòng để vẫn đủ SO_DOAN.
  const hits = await deps.timDoan(cauHoi, SO_DOAN * 2);

  // HÀNG RÀO THỨ HAI: bỏ đoạn có dấu hiệu giá. Model có thể diễn đạt lại câu
  // hỏi để lách hàng rào thứ nhất (ca thật TT-049) — chặn ở đầu ra thì không
  // lách được, vì nó soi chính nội dung tài liệu.
  const sach = hits.filter((h) => !doanCoGia(h.content));
  if (sach.length === 0) return { loai: 'khong_thay', cauHoi };

  return {
    loai: 'ok',
    doan: sach.slice(0, SO_DOAN).map((h) => {
      const t = h.content.trim();
      // Dòng đầu thường là tiêu đề/tên model — giữ riêng để model biết đoạn
      // này nói về sản phẩm nào.
      const [dong1] = t.split('\n');
      return {
        tieuDe: dong1.slice(0, 80),
        noiDung: t.length > DAI_TOI_DA ? `${t.slice(0, DAI_TOI_DA)}…` : t,
        diem: Number(h.score ?? 0),
      };
    }),
  };
}

export const traTriThucDefinition: ToolDefinition = {
  name: 'tra_tri_thuc',
  description:
    'Tra thông tin KỸ THUẬT từ tài liệu/catalog: bảo hành, chuẩn chống nước IP, ' +
    'công suất, điện áp, quang thông, góc chiếu, kích thước, cách lắp đặt, chứng chỉ. ' +
    'GỌI KHI hỏi: "bảo hành mấy năm", "chống nước IP mấy", "công suất bao nhiêu W", ' +
    '"đèn này dùng điện mấy V", "lắp đặt thế nào". ' +
    'TUYỆT ĐỐI KHÔNG dùng cho câu hỏi về GIÁ, TỒN KHO, CÔNG NỢ — ' +
    'những thứ đó phải dùng tra_san_pham / tra_ton_kho / xuat_cong_no ' +
    '(tài liệu có thể cũ, Odoo mới là nguồn đúng).',
  inputSchema: {
    type: 'object',
    properties: {
      cau_hoi: {
        type: 'string',
        description:
          'Câu hỏi kỹ thuật, giữ nguyên cách khách/nhân viên hỏi. ' +
          'Vd: "led thanh L7 bảo hành bao lâu", "nguồn 12V400W có chống nước không"',
      },
    },
    required: ['cau_hoi'],
  },
};

export function dinhDangTriThuc(kq: KetQuaTriThuc): string {
  if (kq.loai === 'cau_hoi_ve_tien') {
    return (
      `KHÔNG tra tài liệu cho câu hỏi về giá/tồn (bắt được "${kq.tuKhoa}"). ` +
      'Tài liệu có thể ghi giá CŨ — báo cho khách là sai. ' +
      'Hãy dùng tra_san_pham (giá), tra_ton_kho (tồn), hoặc xuat_cong_no (nợ).'
    );
  }

  if (kq.loai === 'khong_thay') {
    return (
      'Không tìm thấy thông tin này trong tài liệu kỹ thuật. ' +
      'Nói thật là chưa có tài liệu về việc đó rồi chuyển sale — ĐỪNG suy đoán ' +
      'thông số kỹ thuật, sai thông số là khách lắp hỏng hàng.'
    );
  }

  const dong = kq.doan
    .map((d, i) => `[${i + 1}] ${d.noiDung}`)
    .join('\n\n');

  // Câu rào đầu khối (nhóm B 15/08, học TencentDB l1-recall): đoạn TRUY HỒI
  // có thể lạc đề (khách hỏi bulb, RAG kéo về panel) — phải tự khai là tham
  // khảo, không thì model rẻ bám vào đoạn lạc đề như thể khách vừa nói thế.
  return (
    '[Trích tài liệu — THAM KHẢO, có thể không khớp câu đang hỏi; chỉ dùng đoạn thật sự liên quan]\n' +
    `${dong}\n\n` +
    'Trả lời DỰA TRÊN đoạn trên. Thông số nào không có trong đây thì nói chưa ' +
    'có tài liệu, ĐỪNG bịa. Nguồn: tài liệu kỹ thuật nhà sản xuất.'
  );
}
