// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool: GỬI FILE tài liệu (catalog / datasheet PDF) khi khách hoặc nhân viên xin.
//
// ═══ VÌ SAO TOOL NÀY TỒN TẠI ═══════════════════════════════════════════════
// Bug thật trong nhóm, 03:17-03:18 ngày 11/08/2026:
//
//   03:17:16 bot: "Dạ, hệ thống em đang chỉ tra được nội dung thông số kỹ
//                  thuật trong catalog (bản văn bản/tài liệu nhà sản xuất),
//                  hiện chưa có sẵn file"
//   03:17:58 NV : "a muốn e gửi cho a dạng tài liệu cattalog. @Tiểu Mã Nelia"
//   03:18:29 bot: "Nhân viên muốn tài liệu catalog dạng PDF. Hệ thống em chỉ
//                  tra được nội dung thông số kỹ thuật trong catalog (dạng
//                  văn bản), không ..."
//
// Bot từ chối HAI LẦN, trong khi 8 file PDF datasheet ĐANG NẰM SẴN trên server
// (/var/lib/zalo-crm/files/media/*.pdf). Nội dung 8 file đó đã được nạp vào RAG
// (877 chunk, source `datasheet-pdf`) — nên bot đọc được CHỮ trong file, chỉ là
// không có đường nào để GỬI chính cái FILE.
//
// Anh Quốc chốt: "nếu như khách yêu cầu gửi pdf thì phải gửi luôn nhé".
//
// ═══ KHÁC `tra_tri_thuc` ═══════════════════════════════════════════════════
// `tra_tri_thuc` đọc NỘI DUNG (trả về đoạn văn bản để bot trả lời "IP65",
// "bảo hành 2 năm"). Tool này gửi CHÍNH FILE. Hai việc khác nhau, và đúng chỗ
// bot lẫn lộn lúc 03:17 — nó có tri thức nên tưởng mình "chỉ có văn bản".
//
// ═══ NGUỒN FILE: bảng `messages`, KHÔNG thêm cột nào ═══════════════════════
// `knowledge_documents` không có cột lưu đường dẫn file, nhưng KHÔNG cần thêm:
// mọi file đi qua Zalo đều đã nằm trong `messages` với content_type='file' và
// `content` là JSON có `title` (tên file thật) + `href` (URL tải). Đó CHÍNH LÀ
// sổ đăng ký file, sẵn có, đã đúng.
//
// Chọn cách này vì:
//   1. KHÔNG migration, KHÔNG cột mới, KHÔNG bảng phụ — ít xâm lấn nhất.
//   2. TỰ CẬP NHẬT: nhân viên gửi file mới vào nhóm là bot gửi lại được ngay,
//      không phải chạy script nạp nào. Cột thêm vào `knowledge_documents` thì
//      phải nhớ điền mỗi lần nạp — quên một lần là tài liệu câm.
//   3. Không phụ thuộc việc file đã được nạp RAG hay chưa: hai việc tách rời.
//
// ═══ HÀNG RÀO GIÁ NỘI BỘ ═══════════════════════════════════════════════════
// Hệ quả của việc lấy nguồn từ `messages`: kho file KHÔNG tĩnh. Hôm nay 8 file
// datasheet sạch (đã soát nội dung thật trên prod 11/08: 0/8 dính từ khoá giá),
// nhưng mai nhân viên gửi "Bang gia dai ly.pdf" vào nhóm thì nó tự vào kho.
// Nên `locGiaNoiBo` chặn ở CODE, cùng nếp với `TU_KHOA_CAM` của
// scripts/nap-tri-thuc.ts và danh sách trắng field của `tra_san_pham`.

import type { ToolDefinition } from '../../agent/types.js';

/** Một tài liệu gửi được. */
export interface TaiLieu {
  /** Tên file thật, gồm cả đuôi — vd "LLR - P4 3840-7680HZ.pdf". */
  tieuDe: string;
  /** Đường dẫn tải: URL http(s) hoặc đường dẫn cục bộ trên server. */
  duongDan: string;
  /** Kích thước byte — để báo cho người xin biết file nặng bao nhiêu. */
  kichThuoc: number;
}

/**
 * ĐUÔI FILE được coi là "tài liệu" gửi cho người xin.
 *
 * CỐ Ý HẸP: kho lấy từ `messages` nên có cả .xlsx báo cáo nội bộ do chính bot
 * xuất ra (top-san-pham, don-nhap-cho-xac-nhan…). Những cái đó là số liệu kinh
 * doanh, TUYỆT ĐỐI không phải thứ đem gửi khi ai đó nói "cho xin catalog".
 */
const DUOI_TAI_LIEU = ['.pdf'];

/**
 * Từ khoá trong TÊN FILE báo hiệu giá nội bộ → loại khỏi kho gửi được.
 *
 * Giữ ĐỒNG BỘ với `TU_KHOA_CAM` trong scripts/nap-tri-thuc.ts: cùng một mối lo
 * (giá vốn/giá đại lý lọt ra ngoài), nên cùng một danh sách. Thêm bản tiếng
 * Việt không dấu vì tên file nhân viên đặt hay không dấu.
 */
const TU_KHOA_GIA = [
  'agent price', 'vip price', 'project price', 'cost price', 'wholesale price',
  'dealer price', 'price list',
  'gia von', 'gia nhap', 'gia dai ly', 'gia si', 'bang gia',
];

/** Bỏ dấu tiếng Việt để so khớp (nhân viên gõ/đặt tên file hay không dấu). */
export function boDau(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .trim();
}

/**
 * Lọc kho file: chỉ giữ TÀI LIỆU gửi được.
 *
 * Hai tầng, cả hai đều cần:
 *   1. Đuôi file — bỏ .xlsx báo cáo nội bộ bot tự xuất.
 *   2. Từ khoá giá trong tên — bỏ bảng giá đại lý nhân viên lỡ gửi vào nhóm.
 *
 * Đây là hàng rào DUY NHẤT giữa kho file động và luồng KHÁCH, nên nó phải
 * "mặc định từ chối": chỉ đuôi trong `DUOI_TAI_LIEU` mới lọt.
 */
export function locGiaNoiBo(kho: TaiLieu[]): TaiLieu[] {
  return kho.filter((t) => {
    const ten = boDau(t.tieuDe);
    if (!DUOI_TAI_LIEU.some((d) => ten.endsWith(d))) return false;
    return !TU_KHOA_GIA.some((k) => ten.includes(k));
  });
}

/**
 * Cụm từ cho biết người ta đang XIN FILE, không phải hỏi thông số.
 *
 * "cattalog" (sai chính tả) nằm trong danh sách vì đó là CHÍNH CÂU đã gây bug
 * lúc 03:17:58 — "a muốn e gửi cho a dạng tài liệu cattalog". Người thật gõ
 * sai chính tả; hàng rào phải chịu được điều đó.
 */
const CUM_XIN_TAI_LIEU = [
  'catalog', 'catalogue', 'cattalog', 'cataloge',
  'datasheet', 'data sheet', 'tai lieu', 'tailieu',
  'file pdf', 'ban pdf', 'dang pdf', 'file ky thuat',
  'ho so ky thuat', 'thong so dang file',
];

/** Động từ đi kèm — "gửi/cho xin/có ... không" mới là XIN, chứ không phải nhắc tới. */
const DONG_TU_XIN = ['gui', 'cho xin', 'xin', 'co', 'can', 'muon', 'gia', 'file', 'pdf'];

/**
 * Câu này có phải XIN TÀI LIỆU không?
 *
 * Dùng để (a) test khoá lại câu thật gây bug, (b) tài liệu hoá cho người sau
 * biết bot nhận diện những cách nói nào. Việc GỌI tool vẫn do model quyết —
 * hàm này KHÔNG chặn gì, chỉ nhận diện.
 */
export function laYeuCauTaiLieu(cau: string): boolean {
  const t = boDau(cau);
  if (!t) return false;
  // "pdf" trần cũng tính — "gửi file pdf cho anh" không chứa chữ "tài liệu".
  const coDoi = CUM_XIN_TAI_LIEU.some((c) => t.includes(c)) || /\bpdf\b/.test(t);
  if (!coDoi) return false;
  return DONG_TU_XIN.some((d) => t.includes(d));
}

/** Token có ý nghĩa phân biệt tài liệu — bỏ từ chung để khỏi khớp tràn lan. */
const BO_QUA = new Set([
  'gui', 'cho', 'xin', 'anh', 'chi', 'em', 'a', 'e', 'toi', 'minh', 'ban',
  'tai', 'lieu', 'file', 'pdf', 'catalog', 'catalogue', 'cattalog', 'datasheet',
  've', 'cua', 'voi', 'la', 'co', 'khong', 'ko', 'muon', 'can', 'dang', 'ban',
  'led', 'den', 'nhe', 'nha', 'a', 'ạ', 'di', 'luon', 'giup', 'xem', 'the',
]);

/** Tách token so khớp: chữ + số, giữ dấu chấm trong mã model (P3.076). */
function tach(s: string): string[] {
  return boDau(s)
    .replace(/[_\-–—/\\]+/g, ' ')
    .split(/[^a-z0-9.]+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ''))
    .filter((w) => w.length > 0);
}

/**
 * Token nào là MÃ SẢN PHẨM (p4, p10, p3.076, 3840hz, 7680hz).
 *
 * Mã model là thứ DUY NHẤT phân biệt 8 datasheet với nhau — tên chúng gần như
 * trùng hệt ("LLR -P10 -RGB OPLUNG" vs "LLR -P10- RGB -4S"). Khớp từ thường
 * ("outdoor", "rgb") mà không có mã thì gần như chắc chắn là đoán mò.
 */
function laMaModel(w: string): boolean {
  return /^p[0-9]/.test(w) || /^[0-9]{3,}(hz)?$/.test(w) || /^[0-9]+s$/.test(w) || /hz$/.test(w);
}

/**
 * Điểm khớp giữa yêu cầu và một tài liệu. 0 = không khớp gì.
 *
 * Mã model được nhân trọng số vì đó là thứ phân biệt thật (xem `laMaModel`).
 * Không dùng vector/RAG ở đây: tên file là chuỗi ngắn, khớp token trực tiếp
 * vừa chính xác hơn vừa không tốn một lần gọi embedding cho mỗi yêu cầu.
 */
export function diemKhopTaiLieu(yeuCau: string, taiLieu: TaiLieu): number {
  const q = tach(yeuCau).filter((w) => !BO_QUA.has(w));
  if (q.length === 0) return 0;
  const ten = new Set(tach(taiLieu.tieuDe.replace(/\.[^.]+$/, '')));

  let diem = 0;
  for (const w of q) {
    if (ten.has(w)) {
      diem += laMaModel(w) ? 3 : 1;
      continue;
    }
    // Khớp một phần cho mã dính liền ("3840hz" trong tên là "3840-7680HZ").
    if (laMaModel(w)) {
      const so = w.replace(/hz$/, '');
      if (so.length >= 2 && [...ten].some((t) => t.includes(so))) diem += 2;
    }
  }
  return diem;
}

/** Điểm tối thiểu để coi là "có khớp" — dưới ngưỡng thì thà nói không thấy. */
const NGUONG_KHOP = 2;

/**
 * Khoảng cách điểm để coi là "khớp DUY NHẤT một cái".
 *
 * Cái đầu phải hơn cái nhì ÍT NHẤT chừng này thì mới tự gửi. Sát nhau nghĩa là
 * yêu cầu mơ hồ ("gửi tài liệu P10" khớp cả hai file P10) — lúc đó HỎI, đừng
 * đoán: gửi nhầm file thì người ta phải đọc xong mới biết là sai.
 */
const CACH_BIET = 2;

/** Số tài liệu liệt kê tối đa khi phải hỏi lại — nhiều hơn là tin Zalo quá dài. */
const LIET_KE_TOI_DA = 8;

export interface GuiTaiLieuDeps {
  /** Liệt kê tài liệu gửi được. Đã LỌC qua `locGiaNoiBo` trước khi tới đây. */
  liet: () => Promise<TaiLieu[]>;
  /** Tải tài liệu về file cục bộ, trả đường dẫn — `zaloOps.sendFile` cần path. */
  taiVe: (t: TaiLieu) => Promise<string>;
}

export type KetQuaGuiTaiLieu =
  | { loai: 'da_gui'; taiLieu: TaiLieu; duongDanCucBo: string }
  | { loai: 'nhieu_ket_qua'; ungVien: TaiLieu[] }
  | { loai: 'khong_thay'; yeuCau: string }
  | { loai: 'loi'; tieuDe: string; lyDo: string };

export async function guiTaiLieu(
  deps: GuiTaiLieuDeps,
  input: { yeu_cau: string },
): Promise<KetQuaGuiTaiLieu> {
  const yeuCau = input.yeu_cau?.trim() ?? '';
  const kho = await deps.liet();
  if (kho.length === 0) return { loai: 'khong_thay', yeuCau };

  const xep = kho
    .map((t) => ({ t, d: diemKhopTaiLieu(yeuCau, t) }))
    .sort((a, b) => b.d - a.d);

  const dau = xep[0];

  // Không câu nào khớp đủ mạnh. Rẽ hai nhánh, và ranh giới nằm ở chỗ người ta
  // có NÊU TÊN thứ cụ thể hay không:
  //
  //   "gửi cho anh tài liệu catalog"      → xin CHUNG CHUNG, chưa biết muốn gì
  //                                          → liệt kê cho chọn. Trả lời "không
  //                                          có" ở đây CHÍNH LÀ bug 03:17.
  //   "gửi catalog đèn năng lượng SL500"  → nêu RÕ thứ mình muốn, kho không có
  //                                          → nói thẳng chưa có. Liệt kê 8 file
  //                                          LED khác là lảng tránh câu hỏi.
  if (!dau || dau.d < NGUONG_KHOP) {
    const noiCuThe = tach(yeuCau).filter((w) => !BO_QUA.has(w)).length > 0;
    if (laYeuCauTaiLieu(yeuCau) && !noiCuThe) {
      return { loai: 'nhieu_ket_qua', ungVien: kho.slice(0, LIET_KE_TOI_DA) };
    }
    return { loai: 'khong_thay', yeuCau };
  }

  // Nhiều cái điểm sát nhau → HỎI, đừng đoán. Gửi bừa cả 8 file (17MB) vào
  // nhóm vừa là spam vừa khiến người ta phải tự dò file nào mới đúng.
  const satNhau = xep.filter((x) => x.d > 0 && dau.d - x.d < CACH_BIET);
  if (satNhau.length > 1) {
    return { loai: 'nhieu_ket_qua', ungVien: satNhau.slice(0, LIET_KE_TOI_DA).map((x) => x.t) };
  }

  // TẢI VỀ THẬT rồi mới báo "đã gửi". Tải lỗi (CDN Zalo hết hạn, file bị xoá)
  // phải thành 'loi' — báo "đã gửi" khi file chưa đi là đúng kiểu bịa mà cả ba
  // hàng rào khoeDaGhi/khoeDaGuiAnh/khoeDaGuiTaiLieu đang chống.
  try {
    const duongDanCucBo = await deps.taiVe(dau.t);
    return { loai: 'da_gui', taiLieu: dau.t, duongDanCucBo };
  } catch (err) {
    return {
      loai: 'loi',
      tieuDe: dau.t.tieuDe,
      lyDo: err instanceof Error ? err.message : String(err),
    };
  }
}

export const guiTaiLieuDefinition: ToolDefinition = {
  name: 'gui_tai_lieu',
  description:
    'GỬI FILE tài liệu/catalog/datasheet PDF cho người đang chat. ' +
    'GỌI KHI họ xin CHÍNH FILE: "gửi catalog", "cho xin tài liệu P10", ' +
    '"gửi datasheet 3840hz", "cho xin bản PDF", "a muốn e gửi cho a dạng tài liệu". ' +
    'KHÁC tra_tri_thuc: tra_tri_thuc chỉ ĐỌC NỘI DUNG tài liệu để trả lời thông ' +
    'số (IP, bảo hành, công suất); tool này gửi ĐÚNG CÁI FILE. ' +
    'Hỏi thông số → tra_tri_thuc. Xin file → tool này. ' +
    'Khớp nhiều tài liệu thì tool trả về danh sách để bạn HỎI LẠI cho chọn — ' +
    'ĐỪNG tự đoán. Không có tài liệu thì nói thẳng là chưa có, ĐỪNG hứa gửi sau.',
  inputSchema: {
    type: 'object',
    properties: {
      yeu_cau: {
        type: 'string',
        description:
          'Tài liệu họ muốn, giữ nguyên cách họ nói kèm mã sản phẩm nếu có. ' +
          'Vd: "catalog P10 RGB ốp lưng", "datasheet P4 3840hz", "tài liệu catalog".',
      },
    },
    required: ['yeu_cau'],
  },
};

/** Cỡ file cho người ta biết trước khi tải — MB một chữ số thập phân. */
function coFile(byte: number): string {
  return byte >= 1024 * 1024
    ? `${(byte / 1024 / 1024).toFixed(1)}MB`
    : `${Math.max(1, Math.round(byte / 1024))}KB`;
}

export function dinhDangGuiTaiLieu(kq: KetQuaGuiTaiLieu): string {
  if (kq.loai === 'da_gui') {
    return (
      `ĐÃ GỬI file "${kq.taiLieu.tieuDe}" (${coFile(kq.taiLieu.kichThuoc)}) qua Zalo. ` +
      'Báo lại ngắn gọn là đã gửi tài liệu đó, nêu đúng TÊN FILE này. ' +
      'ĐỪNG nói tên tài liệu khác, ĐỪNG hứa gửi thêm thứ chưa gửi.'
    );
  }

  if (kq.loai === 'nhieu_ket_qua') {
    const dong = kq.ungVien
      .map((t, i) => `${i + 1}. ${t.tieuDe} (${coFile(t.kichThuoc)})`)
      .join('\n');
    return (
      `CHƯA GỬI GÌ. Có ${kq.ungVien.length} tài liệu khớp:\n${dong}\n\n` +
      'HỎI LẠI họ muốn cái nào rồi gọi lại gui_tai_lieu với tên cụ thể. ' +
      'ĐỪNG gửi hết — dội cả chục file vào chat là làm phiền. ' +
      'ĐỪNG nói "đã gửi": chưa file nào được gửi cả.'
    );
  }

  // LƯU Ý cho người sửa sau: hai câu dưới đây TRÁNH viết lại nguyên văn cụm
  // "đã gửi" / "gửi sau" ngay cả trong lời CẤM. Model hay nhặt cụm từ trong
  // kết quả tool rồi chép vào câu trả lời — cấm bằng chính cụm cần cấm là tự
  // đặt cái bẫy. Test khoá điều này lại (gui-tai-lieu.func.ts).
  if (kq.loai === 'loi') {
    return (
      `THẤT BẠI khi tải file "${kq.tieuDe}": ${kq.lyDo}. File CHƯA rời khỏi hệ thống. ` +
      'Nói THẬT là file đang lỗi chưa lấy được, và nhờ nhân viên gửi tay giúp. ' +
      'TUYỆT ĐỐI KHÔNG báo là việc gửi đã xong.'
    );
  }

  return (
    'Chưa có tài liệu nào khớp yêu cầu này trong kho file. ' +
    'Nói THẲNG là bên mình chưa có sẵn tài liệu đó rồi chuyển cho nhân viên. ' +
    'ĐỪNG hứa hẹn một lần gửi trong tương lai — không có gì để gửi cả.'
  );
}
