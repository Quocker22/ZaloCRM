// SPDX-License-Identifier: AGPL-3.0-or-later
// CON ĐIỀU PHỐI PHIÊN — một lượt deepseek-v4-flash BẬT SUY NGHĨ RIÊNG, đầu ra
// BẮT BUỘC là tool `cap_nhat_phien` (kiểu harness: model nghĩ trong
// reasoning_content, chỉ được nói bằng object có cấu trúc — không thể rò suy
// nghĩ ra tin, không thể "trả lời hộ").
//
// Việc của nó: đọc tin mới + lịch sử + phiên hiện tại → ghi nhận người ta
// ĐÃ nói gì (ô da_co), nói MƠ HỒ chỗ nào (mo_ho + lý do), TỪ CHỐI cho gì
// (tu_choi), và ý định lượt này. Nó KHÔNG quyết hỏi gì: `oConThieu` (code)
// quyết, để "không hỏi lại ô đã có" là luật cứng chứ không phải lời dặn.
//
// Fail-open tuyệt đối: lỗi/chậm/model không gọi tool → trả phiên cũ nguyên
// vẹn + nguon 'loi'; luồng gọi không bao giờ chờ nó để trả lời khách.
import { logger } from '../../../../shared/utils/logger.js';
import type { ToolAwareGenerate, ToolDefinition } from '../types.js';
import { chayVongKiemChung, tomTatBangChung, type BangChung, type ToolKiemChung } from '../harness/vong-kiem-chung.js';
import { boToolKiemChung, type DepsKiemChung } from '../harness/tool-kiem-chung.js';
import {
  type PhienDon, type DongHang, type O, type TenO, type TrangThaiO, tomTatPhien, oConThieu, duDeLenDon,
} from './phien-don.js';

export const TIMEOUT_DIEU_PHOI_MS = 25_000;
const LICH_SU_TOI_DA = 10;

export type YDinh = 'hoi_gia' | 'dat_hang' | 'sua_don' | 'nhap_hang' | 'hoi_ton' | 'hoi_khac' | 'tan_gau' | 'buc' | 'xac_nhan' | 'huy';

export interface KetQuaDieuPhoi {
  phien: PhienDon;
  yDinh: YDinh;
  /** Ô còn thiếu/mơ hồ theo thứ tự nên hỏi (code tính, không phải model). */
  canHoi: ReturnType<typeof oConThieu>;
  duDeLenDon: boolean;
  /** Model nêu gì đáng chú ý (đổi ý, hai giá, khách bực…) — để log, không gửi. */
  luuY?: string;
  nguon: 'llm' | 'loi';
  ms: number;
  lyDo?: string;
  /** Tool chỉ-đọc model đã gọi để kiểm chứng (harness) — để log/đo. */
  bangChung?: BangChung[];
  soVong?: number;
}

export interface DauVaoDieuPhoi {
  phien: PhienDon;
  cauMoi: string;
  lichSu: Array<{ vai: 'khach' | 'nhanvien' | 'bot'; noiDung: string }>;
  /** Ngữ cảnh code biết: mục lục SP, giá đã tra, nội dung ảnh… (tuỳ chọn). */
  nguCanh?: string;
}

const TRANG_THAI: TrangThaiO[] = ['da_co', 'thieu', 'mo_ho', 'tu_choi'];
const oSchema = (giaTri: Record<string, unknown>) => ({
  type: 'object',
  properties: {
    trangThai: { type: 'string', enum: TRANG_THAI },
    giaTri,
    ghiChu: { type: 'string', description: 'Vì sao mơ hồ / người ta nói gì (ngắn). BẮT BUỘC khi mo_ho.' },
  },
  required: ['trangThai'],
});

const capNhatPhienDefinition: ToolDefinition = {
  name: 'cap_nhat_phien',
  description:
    'Ghi nhận trạng thái ĐƠN sau tin mới. LUÔN gọi tool này, không trả lời text. ' +
    'Chỉ điền ô có THAY ĐỔI so với phiên hiện tại; ô không nhắc tới thì bỏ trống (giữ nguyên).',
  inputSchema: {
    type: 'object',
    properties: {
      y_dinh: {
        type: 'string',
        enum: ['hoi_gia', 'dat_hang', 'sua_don', 'nhap_hang', 'hoi_ton', 'hoi_khac', 'tan_gau', 'buc', 'xac_nhan', 'huy'],
        description: 'Ý định của TIN MỚI: hoi_gia = hỏi giá/tư vấn chưa mua; dat_hang = muốn mua/lên đơn; sua_don = đổi đơn đã lên; xac_nhan = "ok/đúng rồi/chốt"; huy = thôi không mua.',
      },
      che: { type: 'string', enum: ['khong', 'hoi_gia', 'dat_hang', 'sua_don', 'nhap_hang'], description: 'Chế độ phiên SAU tin này.' },
      khach: oSchema({
        type: 'object',
        properties: {
          ten: { type: 'string' }, sdt: { type: 'string' }, maKh: { type: 'string' },
          id: { type: 'number', description: 'id khách trên Odoo — CHỈ lấy từ kết quả tool tim_khach (đã tra lượt này hoặc lượt trước). Không có thì bỏ trống.' },
          moi: { type: 'boolean', description: 'người ta nói rõ là khách mới' },
        },
      }),
      dong: {
        type: 'array',
        description: 'TOÀN BỘ danh sách hàng sau tin này (thay thế danh sách cũ). Mỗi dòng: tên NGUYÊN VĂN người ta nói; số lượng/giá là ô có trạng thái. Giá đổi ra ĐỒNG ("180k"→180000, "1tr2"→1200000). Có giá trong ảnh/hoá đơn cũ thì điền.',
        items: {
          type: 'object',
          properties: {
            ten: { type: 'string' },
            spId: { type: 'number', description: 'id SP trên Odoo — CHỈ lấy từ kết quả tool tim_sp. Người ta chọn "a"/"2"/"loại trong" thì đối chiếu danh sách bot đã hỏi trong lịch sử rồi điền id đó. Chưa rõ loại nào → bỏ trống + soLuong/donGia giữ nguyên.' },
            donVi: { type: 'string' },
            soLuong: oSchema({ type: 'number' }),
            donGia: oSchema({ type: 'number' }),
            chietKhauPhanTram: { type: 'number' },
            tang: { type: 'boolean' },
          },
          required: ['ten', 'soLuong', 'donGia'],
        },
      },
      kho: oSchema({ type: 'string' }),
      phuPhi: oSchema({ type: 'array', items: { type: 'object', properties: { ten: { type: 'string' }, tien: { type: 'number' } }, required: ['ten', 'tien'] } }),
      vatPhanTram: oSchema({ type: 'number' }),
      chietKhauDonPhanTram: oSchema({ type: 'number' }),
      giaoHang: oSchema({
        type: 'object',
        properties: { cach: { type: 'string', enum: ['ship', 'lay_tai_kho', 'chanh'] }, diaChi: { type: 'string' }, sdtNhan: { type: 'string' }, thoiGian: { type: 'string' } },
      }),
      thanhToan: oSchema({ type: 'string', enum: ['chuyen_khoan', 'cod', 'cong_no', 'tien_mat'] }),
      ghi_chu: { type: 'string' },
      luu_y: { type: 'string', description: 'Một câu: điều đáng chú ý cho máy (đổi ý, hai giá, mâu thuẫn với lịch sử…). Để trống nếu không có.' },
    },
    required: ['y_dinh', 'che'],
  },
};

const SYSTEM = [
  'Bạn là bộ ĐIỀU PHỐI PHIÊN của bot bán hàng LED (Nelia). Việc DUY NHẤT: đọc tin',
  'mới của người đang chat (khách hoặc nhân viên), đối chiếu lịch sử và PHIÊN HIỆN',
  'TẠI, rồi gọi tool cap_nhat_phien ghi lại trạng thái đơn. KHÔNG trả lời người',
  'chat, KHÔNG bịa dữ liệu, KHÔNG tự tính tổng.',
  'Luật ghi ô:',
  '- da_co: người ta đã nói rõ (hoặc có trong ảnh/hoá đơn họ gửi). Điền giaTri.',
  '- mo_ho: đã nói nhưng có ≥2 cách hiểu, hoặc mâu thuẫn với điều đã nói trước',
  '  (hai giá cho một món, "20m mỗi loại" mà không rõ loại nào). Ghi ghiChu vì sao.',
  '- tu_choi: người ta nói "không cần", "để sau", "không có" → KHÔNG hỏi lại nữa.',
  '- Không nhắc tới → bỏ trống ô đó (giữ nguyên phiên).',
  'Số lượng, giá: chỉ ghi số người ta NÓI. "giá như hôm trước"/"như hoá đơn cũ"',
  'mà có số trong ảnh/lịch sử thì lấy số đó; không có thì mo_ho.',
  'Người ta đổi ý ("thôi 15 cái", "bỏ nguồn") → ghi trạng thái MỚI thay cũ và nêu',
  'trong luu_y. Tin chỉ là "ok"/"đúng rồi"/"chốt" → y_dinh=xac_nhan, không đổi ô.',
  'Tin tán gẫu/hỏi thông số/hỏi tồn không liên quan đơn → y_dinh tương ứng, che',
  'giữ nguyên, không đổi ô.',
  'Tên hàng ghi NGUYÊN VĂN (kể cả sai chính tả) — máy sẽ tra Odoo; đừng "sửa" tên.',
  'Nếu có tool CHỈ ĐỌC (tra_khach_hang, tra_san_pham): DÙNG khi tên khách/hàng có',
  'thể trùng nhiều người/nhiều loại hoặc giá chưa rõ — tra rồi ghi ô là da_co',
  '(một kết quả) hay mo_ho (nhiều kết quả, ghiChu liệt kê ngắn). Được tra MỘT',
  'lượt (gọi nhiều tool cùng lúc), rồi PHẢI gọi cap_nhat_phien.',
].join('\n');

function hienLichSu(ls: DauVaoDieuPhoi['lichSu']): string {
  return ls.slice(-LICH_SU_TOI_DA)
    .map((m) => `[${m.vai === 'bot' ? 'BOT' : m.vai === 'nhanvien' ? 'NV' : 'KHÁCH'}] ${m.noiDung.slice(0, 400)}`)
    .join('\n') || '(chưa có)';
}

/** Ô model trả về có hợp lệ không — sai cấu trúc thì bỏ ô đó, giữ cũ. */
function docO<T>(raw: unknown, kiem: (v: unknown) => v is T): O<T> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!TRANG_THAI.includes(r.trangThai as TrangThaiO)) return null;
  const tt = r.trangThai as TrangThaiO;
  const o: O<T> = { trangThai: tt };
  if (tt === 'da_co') {
    if (!kiem(r.giaTri)) return null; // da_co mà không có giá trị hợp lệ = bịa
    o.giaTri = r.giaTri;
  }
  if (typeof r.ghiChu === 'string' && r.ghiChu.trim()) o.ghiChu = r.ghiChu.trim().slice(0, 200);
  if (tt === 'mo_ho' && !o.ghiChu) o.ghiChu = 'chưa rõ';
  return o;
}

const laSo = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1_000_000_000;
const laChuoi = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
/** SĐT VN hợp lý: 9–12 chữ số (đo e2e 27/08: model bịa "0980988983751075"). */
const laSdtHopLy = (v: unknown): boolean => typeof v === 'string' && /^\+?\d{9,12}$/.test(v.replace(/[\s.-]/g, ''));
const laKhach = (v: unknown): v is NonNullable<PhienDon['khach']['giaTri']> =>
  !!v && typeof v === 'object' && (laChuoi((v as { ten?: unknown }).ten) || laSo((v as { id?: unknown }).id));
const laPhuPhi = (v: unknown): v is Array<{ ten: string; tien: number }> =>
  Array.isArray(v) && v.every((x) => x && typeof x === 'object' && laChuoi((x as { ten?: unknown }).ten) && laSo((x as { tien?: unknown }).tien));
const laGiao = (v: unknown): v is NonNullable<PhienDon['giaoHang']['giaTri']> =>
  !!v && typeof v === 'object' && ['ship', 'lay_tai_kho', 'chanh'].includes(String((v as { cach?: unknown }).cach));
const laThanhToan = (v: unknown): v is NonNullable<PhienDon['thanhToan']['giaTri']> =>
  ['chuyen_khoan', 'cod', 'cong_no', 'tien_mat'].includes(String(v));

/** Áp output tool vào phiên — HÀM THUẦN, export để test từng luật gộp. */
export function apCapNhat(cu: PhienDon, raw: Record<string, unknown>, bayGio: Date = new Date()): { phien: PhienDon; yDinh: YDinh; luuY?: string } {
  const p: PhienDon = JSON.parse(JSON.stringify(cu)) as PhienDon;
  const yDinhRaw = String(raw.y_dinh ?? 'hoi_khac');
  const yDinh = (['hoi_gia', 'dat_hang', 'sua_don', 'nhap_hang', 'hoi_ton', 'hoi_khac', 'tan_gau', 'buc', 'xac_nhan', 'huy'] as YDinh[]).includes(yDinhRaw as YDinh)
    ? (yDinhRaw as YDinh) : 'hoi_khac';
  const che = String(raw.che ?? '');
  if (['khong', 'hoi_gia', 'dat_hang', 'sua_don', 'nhap_hang'].includes(che)) p.che = che as PhienDon['che'];
  if (yDinh === 'huy') p.che = 'khong';

  const kh = docO(raw.khach, laKhach);
  if (kh) {
    // SĐT rác (quá dài/ngắn) → bỏ SĐT, giữ tên; không để rác vào Odoo sau này.
    if (kh.giaTri && kh.giaTri.sdt !== undefined && !laSdtHopLy(kh.giaTri.sdt)) delete kh.giaTri.sdt;
    p.khach = kh;
  }
  if (Array.isArray(raw.dong)) {
    const dong: DongHang[] = [];
    for (const d of raw.dong as unknown[]) {
      if (!d || typeof d !== 'object') continue;
      const r = d as Record<string, unknown>;
      const ten = r.ten;
      if (!laChuoi(ten)) continue;
      const soLuong = docO(r.soLuong, laSo) ?? { trangThai: 'thieu' as const };
      const donGia = docO(r.donGia, laSo) ?? { trangThai: 'thieu' as const };
      // spId: model điền (từ tim_sp) thắng; không điền thì giữ id đã khớp lượt
      // trước nếu tên không đổi. Kiểm id có trong bằng chứng là việc của caller.
      const cuDong = cu.dong.find((x) => x.ten.trim().toLowerCase() === ten.trim().toLowerCase());
      const spId = laSo(r.spId) && (r.spId as number) > 0 ? (r.spId as number) : cuDong?.spId;
      dong.push({
        ten: ten.trim().slice(0, 120),
        ...(spId ? { spId } : {}),
        ...(spId && cuDong?.spId === spId && cuDong.tenOdoo ? { tenOdoo: cuDong.tenOdoo, ...(cuDong.giaOdoo != null ? { giaOdoo: cuDong.giaOdoo } : {}) } : {}),
        soLuong, donGia,
        ...(laChuoi(r.donVi) ? { donVi: r.donVi.trim() } : {}),
        ...(laSo(r.chietKhauPhanTram) && r.chietKhauPhanTram <= 100 ? { chietKhauPhanTram: r.chietKhauPhanTram } : {}),
        ...(r.tang === true ? { tang: true } : {}),
      });
    }
    p.dong = dong.slice(0, 40);
  }
  const kho = docO(raw.kho, laChuoi); if (kho) p.kho = kho;
  const pp = docO(raw.phuPhi, laPhuPhi); if (pp) p.phuPhi = pp;
  const vat = docO(raw.vatPhanTram, (v): v is number => laSo(v) && (v as number) <= 100); if (vat) p.vatPhanTram = vat;
  const ck = docO(raw.chietKhauDonPhanTram, (v): v is number => laSo(v) && (v as number) <= 100); if (ck) p.chietKhauDonPhanTram = ck;
  const giao = docO(raw.giaoHang, laGiao); if (giao) p.giaoHang = giao;
  const tt = docO(raw.thanhToan, laThanhToan); if (tt) p.thanhToan = tt;
  if (laChuoi(raw.ghi_chu)) p.ghiChu = raw.ghi_chu.trim().slice(0, 300);
  p.capNhatLuc = bayGio.toISOString();
  const luuY = laChuoi(raw.luu_y) ? raw.luu_y.trim().slice(0, 300) : undefined;
  return { phien: p, yDinh, ...(luuY ? { luuY } : {}) };
}

export interface TuyChonDieuPhoi {
  /** Bộ tool chỉ-đọc thay cho bộ mặc định (cầm lái: tim_khach/tim_sp trả JSON có id). */
  kiemChung?: ToolKiemChung[];
  toiDaVong?: number;
  maxTokens?: number;
  /** Đoạn dặn thêm cho vai cầm lái (cách chọn id, đọc câu trả lời chọn…). */
  systemThem?: string;
  /** Trần ký tự kết quả tool (JSON danh sách khách/SP cần rộng hơn 700 mặc định). */
  tranKetQua?: number;
}

export async function dieuPhoiPhien(
  generate: ToolAwareGenerate,
  vao: DauVaoDieuPhoi,
  timeoutMs: number = TIMEOUT_DIEU_PHOI_MS,
  deps: DepsKiemChung = {},
  tuyChon: TuyChonDieuPhoi = {},
): Promise<KetQuaDieuPhoi> {
  const t0 = Date.now();
  const loi = (lyDo: string): KetQuaDieuPhoi => ({
    phien: vao.phien, yDinh: 'hoi_khac', canHoi: oConThieu(vao.phien), duDeLenDon: duDeLenDon(vao.phien),
    nguon: 'loi', ms: Date.now() - t0, lyDo,
  });
  // Khối "[Trả lời tin: …]" hệ thống chèn có thể dài cả tin cũ — cắt còn 150
  // ký tự (prod 27/08: các lượt vượt 25s đều mang khối này).
  const cauMoi = vao.cauMoi.replace(/^\s*\[Trả lời tin:\s*([\s\S]{0,150})[\s\S]*?\]\s*/u, (_m, d: string) => `[Trả lời tin: ${d.trim()}…] `);
  const userMessage =
    `PHIÊN HIỆN TẠI:\n${tomTatPhien(vao.phien)}\n\n` +
    (vao.nguCanh ? `NGỮ CẢNH MÁY BIẾT:\n${vao.nguCanh.slice(0, 1500)}\n\n` : '') +
    `LỊCH SỬ GẦN NHẤT:\n${hienLichSu(vao.lichSu)}\n\n` +
    `TIN MỚI (${vao.phien.vai === 'khach' ? 'KHÁCH' : 'NHÂN VIÊN'}): "${cauMoi}"`;
  try {
    // HARNESS (27/08): có tool chỉ-đọc → model được đi ≤2 vòng kiểm chứng
    // (khách trùng? SP nào? giá?) rồi mới chốt bằng cap_nhat_phien. Không có
    // tool → một lượt như cũ.
    const kiemChung = tuyChon.kiemChung ?? boToolKiemChung({ odoo: deps.odoo }).filter((t) => t.definition.name !== 'doc_odoo');
    const vong = await chayVongKiemChung({
      generate, system: tuyChon.systemThem ? `${SYSTEM}\n${tuyChon.systemThem}` : SYSTEM, userMessage, kiemChung, toolCuoi: capNhatPhienDefinition,
      toiDaVong: tuyChon.toiDaVong ?? 1, timeoutMs, maxTokens: tuyChon.maxTokens ?? 1200,
      ...(tuyChon.tranKetQua ? { tranKetQua: tuyChon.tranKetQua } : {}),
    });
    if (!vong.chot) {
      return { ...loi(vong.lyDo ?? 'model không gọi cap_nhat_phien'), bangChung: vong.bangChung, soVong: vong.soVong };
    }
    const ap = apCapNhat(vao.phien, vong.chot);
    if (vong.bangChung.length > 0) logger.info({ bangChung: tomTatBangChung(vong.bangChung).slice(0, 400) }, '[dieu-phoi] đã kiểm chứng');
    return {
      phien: ap.phien, yDinh: ap.yDinh, canHoi: oConThieu(ap.phien), duDeLenDon: duDeLenDon(ap.phien),
      ...(ap.luuY ? { luuY: ap.luuY } : {}), nguon: 'llm', ms: Date.now() - t0,
      bangChung: vong.bangChung, soVong: vong.soVong,
    };
  } catch (err) {
    logger.warn({ err }, '[dieu-phoi] lỗi/timeout — giữ phiên cũ');
    return loi(err instanceof Error ? err.message : String(err));
  }
}

/** Tên ô để log/hiển thị. */
export type { TenO };
