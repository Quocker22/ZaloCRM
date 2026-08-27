// SPDX-License-Identifier: AGPL-3.0-or-later
// AGENT GIÁM SÁT — soi bản nháp trả lời TRƯỚC KHI gửi Zalo (26/08/2026).
//
// Anh Quốc 26/08 sau ca 09:21 (bot chép nguyên output tool "KHÔNG sửa được
// đơn… Báo rõ lý do cho nhân viên, ĐỪNG nói đã sửa xong" ra nhóm): "bot nó
// cứ ngu như này à? phải tích hợp thêm một con agent giám sát rồi chấp nhận
// việc trả lời lâu hơn xíu với tốn thêm ít token".
//
// VÌ SAO một lượt LLM nữa thay vì thêm regex: hàng rào code chỉ bắt lỗi ĐÃ
// BIẾT (khoeDaGuiTaiLieu, boSuyNghi…); mỗi ca mới lại thêm một regex là hàng
// rào chết. Con giám sát nhìn CẢ ngữ cảnh — câu NV, tool đã gọi + output thô,
// bản nháp — và bắt lỗi CHƯA BIẾT theo 5 luật bên dưới. Model giám sát phải
// KHÁC model chính (cùng model tự soi mình rất kém).
//
// CODE VẪN GIỮ LUẬT: phán quyết là dữ liệu có cấu trúc (tool `phan_quyet`),
// code quyết gửi bản nào; giám sát lỗi/chậm → FAIL-OPEN gửi bản gốc qua hàng
// rào cũ + ghi log, không bao giờ làm bot câm. Mọi phán quyết vào
// tool_call_logs (vai 'giam_sat') để đo: chặn bao nhiêu, đúng bao nhiêu.
import { logger } from '../../../shared/utils/logger.js';
import type { ToolAwareGenerate, ToolDefinition } from './types.js';
import type { ToolCallLog } from './staff-agent.js';
import { chayVongKiemChung, tomTatBangChung, type BangChung } from './harness/vong-kiem-chung.js';
import { boToolKiemChung, type DepsKiemChung } from './harness/tool-kiem-chung.js';

export const MA_LOI = [
  'lo_noi_bo',      // chép chữ dặn model / tiếng Anh / meta ("em mới tra được tới đây")
  'hua_leo',        // nói đã sửa/lên/gửi mà không có tool ghi thành công
  'bia_so',         // mã đơn/tổng tiền/số lượng không có trong output tool
  'vong_lap',       // hỏi lại thứ NV vừa trả lời
  'giau_loi_tool',  // tool ghi thất bại mà không nói thẳng
  'noi_ve_nv',      // nói VỀ nhân viên ("NHÂN VIÊN vừa nói…") thay vì nói VỚI họ
] as const;
export type MaLoi = (typeof MA_LOI)[number];

export interface PhanQuyet {
  ok: boolean;
  loi: MaLoi[];
  /** Bản trả lời đã sửa — chỉ có khi !ok. */
  traLoiSua?: string;
  lyDo?: string;
  /** 'llm' = model phán; 'fail_open' = giám sát lỗi/chậm, gửi bản gốc. */
  nguon: 'llm' | 'fail_open' | 'tat';
  ms: number;
  /** Đoạn độc thoại/nhại câu NV code đã lột khỏi bản nháp (đo được, không cần model). */
  docThoaiBiLot?: string[];
  /** Mã/tiền trong bản nháp KHÔNG có trong tool ∪ câu NV ∪ lịch sử — chứng cứ bịa số. */
  soLa?: string[];
  /** Bản sửa của model làm mất mã/tiền đúng → đã bỏ, dùng bản gốc đã lột. */
  banSuaMatSo?: boolean;
  /** Harness: tool chỉ-đọc đã gọi để kiểm chứng trước khi phán. */
  bangChung?: BangChung[];
  soVong?: number;
  /** true = có dấu hiệu/tầng nhanh phán lỗi → đã chạy tầng nghĩ sâu (reasoning + tool). */
  nghiSau?: boolean;
}

export interface DauVaoGiamSat {
  cauNv: string;
  lichSu: Array<{ vai: 'nhanvien' | 'bot' | 'khach'; noiDung: string }>;
  log: ToolCallLog[];
  traLoi: string;
}

/** Mặc định 14s (có vòng kiểm chứng) — quá thì gửi bản gốc, NV không phải chờ máy soi. */
export const TIMEOUT_GIAM_SAT_MS = 14_000;
const LICH_SU_TOI_DA = 8;
const OUTPUT_TOOL_TOI_DA = 900;

/**
 * DẤU HIỆU CODE THẤY NGAY — đưa cho model làm gợi ý, và là hàng rào tối thiểu
 * khi model fail-open: câu trả lời chứa NGUYÊN VĂN một dòng dặn-model trong
 * output tool ("ĐỪNG nói đã sửa xong", "Báo rõ lý do cho nhân viên"…).
 */
export function dongDanModelBiChep(traLoi: string, log: ToolCallLog[]): string[] {
  const dauHieu = /ĐỪNG|KHÔNG nói|Báo rõ|Trả lời NGẮN|nhắc nhân viên|cho model|TUYỆT ĐỐI/;
  const ra: string[] = [];
  for (const l of log) {
    for (const dong of String(l.output ?? '').split('\n')) {
      const d = dong.trim();
      if (d.length >= 15 && dauHieu.test(d) && traLoi.includes(d)) ra.push(d);
    }
  }
  return [...new Set(ra)];
}

/** Bỏ các dòng dặn-model bị chép — dùng khi phải fail-open. */
export function botDongBiChep(traLoi: string, dongChep: string[]): string {
  let t = traLoi;
  for (const d of dongChep) t = t.split(d).join('');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * ĐỘC THOẠI BỊ CHÉP RA TIN — đo 24h đầu (26/08): 13/20 ca bị sửa là lo_noi_bo,
 * và phần lớn KHÔNG phải chép output tool mà là model viết suy nghĩ của nó vào
 * bản nháp rồi mới viết câu trả lời:
 *   "Có bạn gái chưa" là câu đùa/cá nhân… Tôi đáp ngắn, không gọi tool.
 *   Nhân viên đang nhắn đùa là chưa dùng ảnh để đọc được. Đây là câu trả lời…
 *   Theo luật nhân viên: sau khi in đơn, nếu khách yêu cầu 'xuất đơn'…
 *   Tôi cần dùng báo cáo linh hoạt để đo lợi nhuận. Nhưng… Hãy thử báo cáo…
 * và tật NHẠI câu NV ở đầu: Anh/chị nhắn "Có bao nhiêu người tên Linh" ạ. /
 * in giúp tôi hoá đơn INV/… — em đã in bản này rồi.
 * Những đoạn này nhận ra được bằng code, tất định, không tốn một lượt LLM;
 * lột trước rồi mới đưa model soi phần còn lại. Lột xong mà rỗng → giữ bản
 * gốc (thà lộ còn hơn câm).
 */
const DOC_THOAI = [
  /^(Tôi|Ta|Mình)\s/u,
  /(?:^|\s)(gọi tool|không gọi tool|dùng tool|tool nào|tool tương ứng|qua tool|báo cáo linh hoạt với|doc_odoo|kham_pha_odoo|tra_[a-z_]+|sua_don|tao_don_nhap|bao_cao_[a-z_]+|\bmodel\b)/iu,
  /^Theo luật nhân viên\s*:/iu,
  /^(Đây|Đó) là (câu|yêu cầu|góp ý|thông tin)/iu,
  /^Nhân viên (đang|hỏi|nhắn|muốn|vừa|cần|nói|bảo)/iu,
  /^(Câu|Yêu cầu) (này|đó) (cần|là|nói|hỏi)/iu,
  /^(Hãy|Thực ra|Thực tế|Vậy|Tóm lại|Kết luận|Như vậy|Do đó|Để trả lời|Trước hết)\b/iu,
  // "Tin này không thuộc 3 loại…", "Câu này là trao đổi nội bộ, không nên gửi…"
  /^(Tin|Tin nhắn|Câu|Yêu cầu) (này|đó|trên)\b/iu,
  /(không (nên|được) gửi|trao đổi nội bộ)/iu,
  /(?:^|\s)(hãy (cố gắng|dùng|thử|kiểm tra)|nói rõ (rằng|là)|trả lời (rằng|thẳng|ngắn)|cần trả lời)\b/iu,
  /^Người dùng|^The user/iu,
  // Replay 27/08 (lượt "4 bóng lixin 220V trung tính" nhắc lại): "Đây là loại
  // 3? Hay có thể là sửa đơn?", "Nhìn vào ngữ cảnh: …", "Có vẻ nhân viên đang
  // xác nhận lại", "Tuy nhiên, tin này khá mơ hồ", "Cần hỏi lại để chắc chắn ý
  // nhân viên" — bot nói về NV ở ngôi thứ ba = đang nghĩ, không phải đang nói.
  /^(Đây|Đó) là loại \d/iu,
  /^(Nhìn vào|Xét|Dựa vào|Theo) (ngữ cảnh|bối cảnh|lịch sử)/iu,
  /(?:^|\s)(có vẻ|dường như|chắc là|có lẽ) (nhân viên|NV|người dùng|họ) (đang|vừa|muốn|chỉ)/iu,
  /^(Tuy nhiên|Nhưng),? (tin|câu|yêu cầu) (này|mới|đó)/iu,
  /^Cần (hỏi lại|làm rõ|xác nhận) (để|với|xem)/iu,
  /(?:^|\s)ý (nhân viên|NV|người dùng)\b/iu,
];

function laDoanDocThoai(doan: string): boolean {
  const d = doan.trim();
  if (!d) return false;
  return DOC_THOAI.some((r) => r.test(d));
}

const chuanSo = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Lột độc thoại và câu nhại NV. Trả bản sạch + danh sách đoạn đã lột (để log).
 * Không đụng đoạn nói VỚI người chat ("Anh/chị ơi…", "Dạ…", "Em…").
 */
/**
 * Đoạn nhại có phải câu NV không: mọi token của câu NV nằm trong đoạn nhại và
 * đoạn nhại không dài hơn câu NV quá 3 token ("in giúp tôi hoá đơn INV/…" nhại
 * "in hoá đơn INV/…" — chèn "giúp tôi" vẫn là nhại).
 */
function laNhaiCauNv(doan: string, nv: string): boolean {
  const a = chuanSo(doan).split(' ').filter(Boolean);
  const b = nv.split(' ').filter(Boolean);
  if (b.length === 0 || a.length === 0 || a.length > b.length + 3) return false;
  const co = new Set(a);
  return b.every((t) => co.has(t));
}

export function lotDocThoai(traLoi: string, cauNv: string): { sach: string; daLot: string[]; toanBoDocThoai?: true } {
  const daLot: string[] = [];
  // Soi theo DÒNG: độc thoại hay đứng một dòng riêng dính liền câu trả lời
  // ("Vậy trả lời thẳng:\nAnh ơi…") — tách theo đoạn trống thì lọt.
  const giu: string[] = [];
  for (const dong of traLoi.split('\n')) {
    if (laDoanDocThoai(dong)) { daLot.push(dong.trim()); continue; }
    giu.push(dong);
  }
  let sach = giu.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // Nhại câu NV ở đầu bản nháp.
  const nv = chuanSo(cauNv.replace(/^\s*\[[^\]]*\]\s*/, ''));
  if (nv.length >= 6) {
    const m1 = sach.match(/^(?:Tin nhắn )?(?:anh\/chị|anh|chị)(?: vừa)? (?:nhắn|hỏi|bảo|nói)\s*[“"']([^”"']{4,200})[”"']\s*(?:ạ|nhé|à)?[.!,]?\s*(?:[—–-]\s*)?/iu);
    if (m1 && laNhaiCauNv(m1[1], nv)) { daLot.push(m1[0].trim()); sach = sach.slice(m1[0].length).trim(); }
    // "in giúp tôi hoá đơn INV/… — em đã in…": dòng đầu chính là câu NV rồi gạch ngang.
    const m2 = sach.match(/^([^\n—–]{4,200}?)\s*[—–]\s+/u);
    if (m2 && laNhaiCauNv(m2[1], nv)) { daLot.push(m2[0].trim()); sach = sach.slice(m2[0].length).trim(); }
    // Bắt đầu bằng chữ thường sau khi lột ("nhưng em thấy…") → viết hoa cho tử tế.
    if (daLot.length > 0 && sach.length > 0) sach = sach[0].toUpperCase() + sach.slice(1);
  }
  // Lột xong chẳng còn gì: model chỉ viết suy nghĩ, chưa viết câu trả lời.
  // Trả bản gốc để model giám sát còn có gì mà viết lại, kèm cờ để caller
  // biết KHÔNG được gửi bản này khi fail-open.
  if (sach.length < 10) return { sach: traLoi, daLot: [], ...(daLot.length > 0 ? { toanBoDocThoai: true as const } : {}) };
  return { sach, daLot };
}

/** Mã đơn / số hoá đơn / mã KH / số tiền — thứ không được bịa và không được làm mất. */
const MAU_SO_MA = /INV\/\d{4}\/\d{3,}|\bS\d{4,}\b|\bKH\d{5,}[A-Z-]*|\bP\d{4,}\b|\d{1,3}(?:\.\d{3})+(?:\s?đ|\s?d\b|đ)?|\b\d{4,}\s?(?:đ|d)\b|\b\d{2,}\s?k\b|\b\d+(?:[.,]\d)?\s?(?:tr|triệu)\b/giu;

/** "70k" → "70000", "445,3tr" → "445300000", "1.440.000đ" → "1440000" — cùng một số phải ra cùng một chuỗi. */
function chuanMa(x: string): string {
  const t = x.toLowerCase().replace(/\s+/g, '');
  const mK = t.match(/^(\d+)k$/u);
  if (mK) return String(Number(mK[1]) * 1000);
  const mTr = t.match(/^(\d+(?:[.,]\d)?)(?:tr|triệu)$/u);
  if (mTr) return String(Math.round(Number(mTr[1].replace(',', '.')) * 1_000_000));
  return t.replace(/đ$|d$/u, '').replace(/[.,]/g, '');
}

export function soMaTrong(s: string): string[] {
  return [...new Set((s.match(MAU_SO_MA) ?? []).map(chuanMa).filter((x) => x.length >= 4))];
}

/**
 * Bản sửa của model phải GIỮ mọi mã/tiền có trong bản gốc mà tool xác nhận
 * (có trong output tool). Ca 25/08 23:xx: danh sách 10 khách + doanh số từ
 * tool bị phán bia_so → nếu bản sửa cắt số đúng thì tệ hơn bản gốc.
 */
export function giuSoMaDung(goc: string, sua: string, log: ToolCallLog[]): boolean {
  const tool = new Set(soMaTrong(log.map((l) => String(l.output ?? '')).join('\n')));
  const trongSua = new Set(soMaTrong(sua));
  return soMaTrong(goc).filter((x) => tool.has(x)).every((x) => trongSua.has(x));
}

/** Mã/tiền trong bản nháp không có ở tool ∪ câu NV ∪ lịch sử — nghi bịa. */
export function soLaTrongBanNhap(vao: DauVaoGiamSat, traLoi: string): string[] {
  const nguon = new Set(soMaTrong(
    [vao.cauNv, ...vao.lichSu.map((m) => m.noiDung), ...vao.log.map((l) => `${JSON.stringify(l.input)}\n${String(l.output ?? '')}`)].join('\n'),
  ));
  return soMaTrong(traLoi).filter((x) => !nguon.has(x));
}

/**
 * TÊN KHÁCH trong output tool (nếp formatter: "… · <tên khách> · <tiền>",
 * "Đơn cho <tên> (KH…)", "khách <tên>") mà bản nháp KHÔNG nhắc tới — dấu hiệu
 * bản nháp gán việc cho người khác (ca 10:36 26/08: tool "Tấn Anh - Bình
 * Định", bản nháp "QC Bách Phát"). Model gpt-4.1-mini e2e 27/08 vẫn phán ok
 * dù hai tên nằm cạnh nhau → code phải chỉ tận tay.
 */
/** Tool ĐÃ LÀM VIỆC cho một khách cụ thể — chỉ output của chúng mới có "tên chủ đơn". */
const TOOL_HANH_DONG = new Set(['in_hoa_don', 'xuat_hoa_don', 'tao_don_nhap', 'sua_don', 'gui_hoa_don', 'sua_vat', 'xoa_don', 'huy_don']);

export function tenKhachLech(log: ToolCallLog[], traLoi: string): string[] {
  const ra: string[] = [];
  const draft = chuanSo(traLoi);
  // CHỈ tool hành động: prod 27/08 07:14 tra_san_pham "…khách cần…" bị bắt
  // thành tên khách "cần" → bản nháp đúng bị thay bằng câu "NHẦM đơn" vô nghĩa.
  for (const l of log.filter((x) => TOOL_HANH_DONG.has(x.toolName) && x.thanhCong)) {
    const out = String(l.output ?? '');
    const ten: string[] = [];
    for (const m of out.matchAll(/·\s*([^·\n]{3,60}?)\s*·\s*[\d.]+\s?đ/gu)) ten.push(m[1]);
    for (const m of out.matchAll(/(?:Đơn cho|đơn của)\s+([^\n(:·,]{3,60}?)\s*(?:\(|\[|:|·|,|$)/giu)) ten.push(m[1]);
    for (const t of ten) {
      const tt = t.trim();
      const tk = chuanSo(tt).split(' ').filter((x) => x.length >= 2);
      if (tk.length === 0) continue;
      // Khớp lỏng: ≥ nửa token của tên có trong bản nháp là coi như có nhắc.
      const co = tk.filter((x) => draft.includes(x)).length;
      if (co * 2 < tk.length && !ra.includes(tt)) ra.push(tt);
    }
  }
  return ra;
}

/** Mã đơn / số hoá đơn xuất hiện trong bản nháp ∪ output tool ∪ câu NV. */
export function maDonTrong(s: string): string[] {
  return [...new Set((s.match(/\bS\d{4,}\b|INV\/\d{4}\/\d{3,}/g) ?? []).map((x) => x.toUpperCase()))].slice(0, 4);
}

/**
 * CODE TỰ TRA chủ đơn/hoá đơn theo mã — bằng chứng đưa thẳng vào prompt,
 * không chờ model "có sáng kiến" gọi tool (e2e 27/08: nó không gọi).
 */
export async function bangChungTheoMa(
  odoo: DepsKiemChung['odoo'], ma: string[],
): Promise<string[]> {
  if (!odoo || ma.length === 0) return [];
  const ra: string[] = [];
  const don = ma.filter((m) => m.startsWith('S'));
  const hd = ma.filter((m) => m.startsWith('INV/'));
  try {
    if (don.length > 0) {
      const rows = await odoo.searchRead<Record<string, unknown>>(
        'sale.order', [['name', 'in', don]], ['name', 'partner_id', 'state', 'amount_total'], { limit: don.length },
      );
      for (const r of rows) ra.push(`${String(r.name)} → khách "${Array.isArray(r.partner_id) ? r.partner_id[1] : '?'}" · ${String(r.state)} · ${Number(r.amount_total ?? 0).toLocaleString('vi-VN')}đ`);
    }
    if (hd.length > 0) {
      const rows = await odoo.searchRead<Record<string, unknown>>(
        'account.move', [['name', 'in', hd]], ['name', 'partner_id', 'state', 'amount_total'], { limit: hd.length },
      );
      for (const r of rows) ra.push(`${String(r.name)} → khách "${Array.isArray(r.partner_id) ? r.partner_id[1] : '?'}" · ${String(r.state)} · ${Number(r.amount_total ?? 0).toLocaleString('vi-VN')}đ`);
    }
  } catch (err) {
    logger.warn({ err }, '[giam-sat] tra chủ đơn theo mã lỗi — bỏ qua');
  }
  return ra;
}

const phanQuyetDefinition: ToolDefinition = {
  name: 'phan_quyet',
  description: 'Phán quyết về bản nháp trả lời. LUÔN gọi tool này, không trả lời text.',
  inputSchema: {
    type: 'object',
    properties: {
      ok: { type: 'boolean', description: 'true = gửi nguyên bản nháp' },
      loi: {
        type: 'array',
        items: { type: 'string', enum: [...MA_LOI] },
        description: 'Mã lỗi phát hiện (rỗng khi ok)',
      },
      tra_loi_sua: {
        type: 'string',
        description:
          'Bản trả lời ĐÃ SỬA để gửi cho nhân viên khi ok=false: tiếng Việt, xưng "em", nói VỚI người ' +
          'đang chat, chỉ dùng số/mã có trong output tool, nói thẳng nếu tool thất bại và bước tiếp theo. ' +
          'Giữ NGẮN như bản gốc.',
      },
      ly_do: { type: 'string', description: 'Một câu vì sao (để đo/soát lại)' },
    },
    required: ['ok', 'loi'],
  },
};

function hienLichSu(ls: DauVaoGiamSat['lichSu']): string {
  return ls.slice(-LICH_SU_TOI_DA)
    .map((m) => `[${m.vai === 'bot' ? 'BOT' : m.vai === 'nhanvien' ? 'NV' : 'KHÁCH'}] ${m.noiDung.slice(0, 400)}`)
    .join('\n');
}

function hienTool(log: ToolCallLog[]): string {
  if (log.length === 0) return '(không gọi tool nào)';
  return log.map((l, i) =>
    `#${i + 1} ${l.toolName} ${l.thanhCong ? 'OK' : 'THẤT BẠI'}\n` +
    `  input: ${JSON.stringify(l.input).slice(0, 400)}\n` +
    `  output: ${String(l.output ?? '').slice(0, OUTPUT_TOOL_TOI_DA)}`).join('\n');
}

const SYSTEM = [
  'Bạn là GIÁM SÁT chất lượng cho bot bán hàng LED trả lời nhân viên qua Zalo.',
  'Bạn nhận: câu nhân viên, vài lượt chat gần nhất, danh sách TOOL bot đã gọi kèm',
  'output THÔ, và BẢN NHÁP bot định gửi. Soi bản nháp theo 5 luật, gọi tool',
  'phan_quyet. KHÔNG bịa thêm dữ kiện; chỉ sửa câu chữ dựa trên output tool.',
  '1) lo_noi_bo: bản nháp chứa chữ dặn-model (kiểu "ĐỪNG nói đã sửa xong", "Báo',
  '   rõ lý do cho nhân viên", "Trả lời NGẮN…"), tiếng Anh, hay meta ("em mới',
  '   tra được tới đây", "The user…"). Output tool là để BOT ĐỌC, không phải để chép.',
  '2) hua_leo: bản nháp nói ĐÃ sửa/lên/xuất/gửi/thêm mà KHÔNG có tool ghi tương ứng',
  '   (sua_don, tao_don_nhap, xuat_hoa_don, gui_hoa_don, gui_tai_lieu…) trả OK.',
  '3) bia_so: mã đơn, số hoá đơn, tổng tiền, số lượng, giá trong bản nháp phải có',
  '   trong output tool hoặc trong câu nhân viên. Số tự cộng/tự đoán = lỗi.',
  '4) vong_lap: bản nháp hỏi lại thứ nhân viên VỪA trả lời trong câu này hoặc lượt',
  '   ngay trước (vd hỏi giá khi NV vừa nói "giá 13k") → sửa thành câu dùng ngay',
  '   thông tin đó, hoặc nói rõ máy chưa áp được và cần NV gõ theo mẫu nào.',
  '5) giau_loi_tool: có tool ghi THẤT BẠI mà bản nháp không nói thẳng vì sao và',
  '   bước tiếp theo (hoặc nói như đã xong).',
  'Cũng gắn noi_ve_nv nếu bản nháp nói VỀ nhân viên ("NHÂN VIÊN vừa nói…", "khách',
  'đang…") thay vì nói VỚI người đang chat.',
  'Bản nháp ổn → ok=true, loi=[]. Có lỗi → ok=false, liệt kê loi, và VIẾT LẠI',
  'tra_loi_sua: tiếng Việt, xưng em, ngắn gọn, đúng số liệu tool, nếu tool ghi thất',
  'bại thì nói "chưa sửa được vì … , anh/chị …". Đừng thêm việc bot chưa làm.',
  'KIỂM CHỨNG TRƯỚC KHI PHÁN (harness): nếu có tool chỉ-đọc, và bản nháp nêu khách/đơn/',
  'hoá đơn/tổng tiền mà output tool lượt này KHÔNG xác nhận (vd bản nháp "đã in đơn',
  'QC Bách Phát" nhưng tool in S15274 không nói chủ đơn là ai) → TRA (doc_odoo sale.order',
  'name/partner_id, tra_khach_hang, tra_san_pham) rồi mới phán. Tối đa 2 lượt tra.',
  'Bản nháp không nêu gì cần đối chiếu → phán ngay, đừng tra cho có.',
  'KHÔNG PHẢI LỖI (đo 26/08, 12/20 ca sửa là báo động giả): bản nháp HỎI CHỌN khi tool',
  'trả nhiều ứng viên hoặc từ chối vì trùng tên/mơ hồ → ĐÚNG, ok=true; số liệu có',
  'trong output tool (danh sách khách, doanh số, biểu đồ) → KHÔNG phải bia_so; lỗi',
  'diễn đạt nhỏ, hơi dài → ok=true. Chỉ sửa khi lỗi làm nhân viên HIỂU SAI hoặc',
  'MẤT VIỆC. Bản sửa phải giữ nguyên mọi mã/số tiền đúng của bản nháp.',
  'KHI hua_leo/bia_so: bản sửa TUYỆT ĐỐI không được chứa "đã thêm/đã sửa/đã lên/đã',
  'xuất/đã gửi" cho việc chưa có tool ghi OK — phải viết "em CHƯA thêm được …",',
  'và KHÔNG nêu con số tổng nào không có trong output tool. Sai luật này là bản',
  'sửa vô giá trị (đo 26/08: model viết "em đã thêm phí… nhưng phần mềm chưa ghi").',
].join('\n');

// (?:^|\s) thay cho \b: JS regex không coi "đ" là ký tự chữ nên \b trước "đã"
// không bao giờ khớp — đo test 26/08.
const DONG_TU_GHI = /(?:^|\s)đã\s+(thêm|sửa|lên|xuất|gửi|tạo|huỷ|hủy|xoá|xóa|cập nhật|ghi)(?:\s|$|[,.!])/i;

/**
 * HÀNG RÀO CODE cho bản sửa: phán `hua_leo`/`bia_so` mà bản sửa vẫn nói "đã
 * <ghi>" thì nó tự mâu thuẫn (đo model thật 26/08: "Em đã thêm phí vận chuyển
 * 70k nhưng phần mềm chưa ghi nhận") → thay bằng câu nói-thật tất định dựng
 * từ output tool, không tin lời model nữa.
 */
export function banSuaConHuaLeo(loi: MaLoi[], sua: string): boolean {
  return (loi.includes('hua_leo') || loi.includes('bia_so')) && DONG_TU_GHI.test(sua);
}

/**
 * Câu nói-thật khi tool đã LÀM VIỆC CHO NGƯỜI KHÁC (ca 10:36 26/08): bản sửa
 * của model e2e 27/08 vẫn viết "Em đã xếp hàng in lại đơn QC Tấn Anh - Bình
 * Định…" — gộp hai tên thành một, giấu chuyện in nhầm. Dựng từ output tool.
 */
export function cauNhamNguoi(log: ToolCallLog[], tenTool: string[]): string {
  const dongDau = log.map((l) => String(l.output ?? '').split('\n')[0].trim()).filter(Boolean).join('; ').slice(0, 220);
  return `Dạ em vừa làm NHẦM đơn: hệ thống ghi nhận "${dongDau}" — là của khách "${tenTool.join('", "')}", không phải khách anh/chị nêu. Em CHƯA làm gì cho đúng khách đó; anh/chị cho em mã đơn hoặc tên đầy đủ để em làm lại ạ.`;
}

/** Bản sửa có thừa nhận việc nhầm/chưa làm không — thiếu là đang giấu. */
export function banSuaThuaNhanNham(sua: string): boolean {
  return /nhầm|không phải|chưa (in|làm|xử lý|sửa|lên|xuất|gửi)|sai (đơn|khách)/iu.test(sua);
}

export function cauNoiThatTatDinh(log: ToolCallLog[]): string {
  const that = log.filter((l) => !l.thanhCong);
  const lyDo = that.length > 0
    ? that.map((l) => String(l.output ?? '').split('\n')[0].slice(0, 160)).join('; ')
    : 'em chưa gọi được thao tác ghi tương ứng trên hệ thống';
  return `Dạ em CHƯA thực hiện được yêu cầu này trên hệ thống ạ (${lyDo}). Anh/chị nhắn lại giúp em theo cách khác, hoặc thao tác trực tiếp trên Odoo ạ.`;
}

export async function giamSatTraLoi(
  generate: ToolAwareGenerate,
  vao: DauVaoGiamSat,
  timeoutMs: number = TIMEOUT_GIAM_SAT_MS,
  deps: DepsKiemChung = {},
): Promise<PhanQuyet> {
  const t0 = Date.now();
  // BƯỚC CODE TRƯỚC: lột độc thoại/nhại câu NV, lột dòng dặn-model bị chép.
  // Model chỉ soi phần còn lại; không có model vẫn có bản sạch để gửi.
  const lot = lotDocThoai(vao.traLoi, vao.cauNv);
  const dongChep = dongDanModelBiChep(lot.sach, vao.log);
  const goc = dongChep.length > 0 ? botDongBiChep(lot.sach, dongChep) : lot.sach;
  const codeDaSua = goc !== vao.traLoi;
  const soLa = soLaTrongBanNhap(vao, goc);
  const tenLech = tenKhachLech(vao.log, goc);
  // Code tự tra chủ đơn theo mã trong bản nháp + output tool (không chờ model).
  const bangChungMa = await bangChungTheoMa(
    deps.odoo,
    maDonTrong([goc, vao.cauNv, ...vao.log.map((l) => String(l.output ?? ''))].join('\n')),
  );
  const goiY =
    (dongChep.length > 0 ? `\nCODE PHÁT HIỆN: bản nháp chép nguyên ${dongChep.length} dòng dặn-model từ output tool (đã lột).` : '') +
    (lot.daLot.length > 0 ? `\nCODE ĐÃ LỘT ${lot.daLot.length} đoạn độc thoại/nhại câu NV — bản nháp dưới đây là bản sau khi lột.` : '') +
    (lot.toanBoDocThoai ? '\nCODE PHÁT HIỆN: TOÀN BỘ bản nháp là độc thoại của model, chưa có câu trả lời cho nhân viên → ok=false, PHẢI viết tra_loi_sua từ output tool.' : '') +
    (soLa.length > 0 ? `\nCODE PHÁT HIỆN mã/số tiền KHÔNG có trong output tool, câu NV hay lịch sử: ${soLa.join(', ')} → soi kỹ bia_so.` : '') +
    (tenLech.length > 0 ? `\nCODE PHÁT HIỆN: output tool nói tới khách "${tenLech.join('", "')}" nhưng bản nháp KHÔNG nhắc tên đó (bản nháp gán việc cho người khác?) → soi kỹ bia_so/hua_leo, đối chiếu bằng chứng dưới.` : '') +
    (bangChungMa.length > 0 ? `\nBẰNG CHỨNG CODE ĐÃ TRA ODOO:\n${bangChungMa.map((b) => `- ${b}`).join('\n')}` : '');
  const userMessage =
    `LỊCH SỬ GẦN NHẤT:\n${hienLichSu(vao.lichSu)}\n\n` +
    `CÂU NHÂN VIÊN VỪA GỬI: "${vao.cauNv}"\n\n` +
    `TOOL BOT ĐÃ GỌI LƯỢT NÀY:\n${hienTool(vao.log)}\n\n` +
    `BẢN NHÁP BOT ĐỊNH GỬI:\n\"\"\"${goc}\"\"\"${goiY}`;
  const themDoDac = {
    ...(lot.daLot.length > 0 ? { docThoaiBiLot: lot.daLot } : {}),
    ...(soLa.length > 0 ? { soLa } : {}),
  };

  const failOpen = (lyDo: string): PhanQuyet => {
    // Toàn bộ là độc thoại mà model giám sát cũng hỏng → thà nói "em chưa xử
    // lý được" còn hơn phơi suy nghĩ nội bộ ra nhóm.
    if (lot.toanBoDocThoai) {
      return { ok: false, loi: ['lo_noi_bo'], traLoiSua: cauNoiThatTatDinh(vao.log), lyDo, nguon: 'fail_open', ms: Date.now() - t0, ...themDoDac };
    }
    return {
      ok: !codeDaSua, loi: codeDaSua ? ['lo_noi_bo'] : [], ...(codeDaSua ? { traLoiSua: goc } : {}),
      lyDo, nguon: 'fail_open', ms: Date.now() - t0, ...themDoDac,
    };
  };

  try {
    // HARNESS (27/08): có tool chỉ-đọc → model đi ≤2 vòng kiểm chứng (đơn của
    // ai, khách có thật không, giá SP) rồi mới phan_quyet; reasoning bật, đầu
    // ra bắt buộc là tool. Không có tool → một lượt như cũ.
    const kiemChung = boToolKiemChung(deps);
    // HAI TẦNG (đo 27/08 với deepseek-v4-flash): reasoning bật là 14–21s cho
    // cả bản nháp ĐÚNG — không thể bắt mọi tin NV gánh. Tầng 1: gác NHANH
    // tắt reasoning, 1 vòng, không tool (~2–4s). Chỉ khi code thấy dấu hiệu
    // (độc thoại, số lạ, tên lệch, tool thất bại) HOẶC tầng 1 phán có lỗi →
    // tầng 2: harness đầy đủ, reasoning bật, ≤2 vòng tool chỉ-đọc, phán
    // quyết tầng 2 thắng. Đây là cách deepseek-harness dùng "nghĩ sâu": theo
    // mục tiêu, khi cần, không phải mọi lúc.
    // Dấu hiệu NẶNG (cần bằng chứng/nghĩ sâu): số lạ, tên khách lệch, tool
    // thất bại. Độc thoại/dòng chép code ĐÃ LỘT XONG — replay 27/08: "có bạn
    // gái chưa" chỉ vì lột 1 dòng mà đi tầng sâu 21s; không đáng.
    const dauHieuNang = soLa.length > 0 || tenLech.length > 0 || vao.log.some((l) => !l.thanhCong);
    const conLai = () => Math.max(1_000, timeoutMs - (Date.now() - t0));
    const nghiSau = () => chayVongKiemChung({
      generate, system: SYSTEM, userMessage, kiemChung, toolCuoi: phanQuyetDefinition,
      toiDaVong: kiemChung.length > 0 ? 2 : 1, timeoutMs: conLai(), maxTokens: 900,
    });
    let canNghiSau = dauHieuNang;
    let vong;
    if (dauHieuNang) {
      vong = await nghiSau();
    } else {
      const nhanh = await chayVongKiemChung({
        generate, system: SYSTEM, userMessage, kiemChung: [], toolCuoi: phanQuyetDefinition,
        toiDaVong: 1, timeoutMs: Math.min(6_000, timeoutMs), maxTokens: 700, suyNghi: false,
      });
      // Tầng nhanh HẾT GIỜ (model chậm) mà không có dấu hiệu nặng → gửi bản
      // đã lột luôn; leo tầng sâu lúc này chỉ cộng dồn timeout (replay: 6+6+14
      // = 31s cho một câu ok). Tầng nhanh PHÁN lỗi → mới nghĩ sâu.
      if (nhanh.chot == null) return failOpen(`tầng nhanh không chốt (${nhanh.lyDo ?? ''}) — không có dấu hiệu nặng, gửi bản đã lột`);
      const nhanhOk = nhanh.chot.ok === true && (!Array.isArray(nhanh.chot.loi) || nhanh.chot.loi.length === 0);
      if (nhanhOk) vong = nhanh;
      else { canNghiSau = true; vong = await nghiSau(); }
    }
    const doDac = { ...themDoDac, ...(vong.bangChung.length > 0 ? { bangChung: vong.bangChung } : {}), soVong: vong.soVong, nghiSau: canNghiSau };
    if (!vong.chot) return { ...failOpen(vong.lyDo ?? 'model không gọi phan_quyet'), ...doDac };
    const raw = vong.chot;
    const bangChungChu = vong.bangChung.length > 0 ? ` | kiểm chứng: ${tomTatBangChung(vong.bangChung).replace(/\n/g, ' ; ').slice(0, 400)}` : '';
    const loi = (Array.isArray(raw.loi) ? raw.loi : []).filter((x): x is MaLoi => (MA_LOI as readonly string[]).includes(String(x)));
    const modelOk = raw.ok === true && loi.length === 0;
    const sua = typeof raw.tra_loi_sua === 'string' ? raw.tra_loi_sua.trim() : '';
    // Model bảo ổn → gửi bản code đã lột (code có lột thì vẫn tính là "sửa").
    if (modelOk && lot.toanBoDocThoai) return failOpen('model bảo ok nhưng bản nháp toàn độc thoại');
    if (modelOk && tenLech.length > 0 && bangChungMa.length > 0) {
      // Code đã tra ra chủ đơn khác tên NV nêu mà model vẫn ok → không tin.
      return {
        ok: false, loi: ['bia_so'], traLoiSua: cauNhamNguoi(vao.log, tenLech),
        lyDo: `model ok nhưng tool làm cho "${tenLech.join(', ')}" (code tra: ${bangChungMa[0]})`, nguon: 'llm', ms: Date.now() - t0, ...doDac,
      };
    }
    if (modelOk) {
      return {
        ok: !codeDaSua, loi: codeDaSua ? ['lo_noi_bo'] : [], ...(codeDaSua ? { traLoiSua: goc } : {}),
        ...(typeof raw.ly_do === 'string' ? { lyDo: raw.ly_do.slice(0, 300) + bangChungChu } : {}),
        nguon: 'llm', ms: Date.now() - t0, ...doDac,
      };
    }
    // Nói có lỗi mà không đưa bản sửa → không tin, gửi bản gốc (đã lột).
    if (sua.length < 5) return failOpen('model báo lỗi nhưng không đưa bản sửa');
    // Bản sửa vẫn còn dòng dặn-model → lột nốt bằng code; vẫn "đã <ghi>" dù
    // phán hứa lèo/bịa số → thay bằng câu nói-thật tất định.
    // Ép câu nói-thật CHỈ khi thật sự không có gì được làm: có tool thất bại,
    // hoặc không gọi tool nào. Mọi tool đều OK (báo cáo + ảnh biểu đồ đi kênh
    // riêng, không nằm trong log) mà bản sửa nói "đã gửi ảnh" là ĐÚNG — ép
    // "em CHƯA thực hiện được" ở đây là làm bản sửa sai (test gd2 27/08).
    const noiThat = cauNoiThatTatDinh(vao.log);
    // …hoặc bản nháp mang SỐ LẠ (tổng tiền không tool nào trả) — ca 26/08
    // "đã thêm phí 70k, tổng 1.320.000đ" trong khi sua_don chỉ sửa số lượng.
    const khongLamDuocGi = vao.log.length === 0 || vao.log.some((l) => !l.thanhCong) || soLa.length > 0;
    // Bản sửa của model cũng có thể mang độc thoại ("Câu này là trao đổi nội
    // bộ, không nên gửi như hiện tại…" — prod 07:30 27/08) → lột như bản nháp.
    const suaLot = lotDocThoai(sua, vao.cauNv);
    const suaSachDocThoai = suaLot.toanBoDocThoai ? goc : suaLot.sach;
    let suaSach = banSuaConHuaLeo(loi, sua) && khongLamDuocGi ? noiThat : botDongBiChep(suaSachDocThoai, dongDanModelBiChep(suaSachDocThoai, vao.log));
    // TOOL LÀM CHO NGƯỜI KHÁC (tên khách lệch) mà bản sửa không thừa nhận nhầm
    // → câu nói-thật tất định, không tin lời viết lại "cho đẹp".
    if (tenLech.length > 0 && !banSuaThuaNhanNham(suaSach)) suaSach = cauNhamNguoi(vao.log, tenLech);
    // Bản sửa làm MẤT mã/tiền đúng (có trong tool) → bản gốc đã lột tốt hơn.
    let banSuaMatSo = false;
    if (suaSach !== noiThat && !giuSoMaDung(goc, suaSach, vao.log)) {
      banSuaMatSo = true;
      suaSach = goc;
    }
    const doiThat = suaSach !== vao.traLoi;
    return {
      ok: !doiThat, loi: doiThat ? loi : [], ...(doiThat ? { traLoiSua: suaSach } : {}),
      ...(typeof raw.ly_do === 'string' ? { lyDo: raw.ly_do.slice(0, 300) + bangChungChu } : {}),
      nguon: 'llm', ms: Date.now() - t0, ...doDac, ...(banSuaMatSo ? { banSuaMatSo: true } : {}),
    };
  } catch (err) {
    logger.warn({ err }, '[giam-sat] lỗi/timeout — fail-open gửi bản gốc');
    return failOpen(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Model giám sát. Anh Quốc 27/08: "dùng deepseek và deepseek-harness để giám
 * sát" — deepseek-v4-flash BẬT suy nghĩ riêng (reasoning) trong vòng kiểm
 * chứng; khác biệt với model chính không nằm ở tên model mà ở CHẾ ĐỘ (chính:
 * tắt reasoning, soạn câu; giám sát: bật reasoning, chỉ được nói bằng tool)
 * và ở BẰNG CHỨNG code đưa tận tay. Đổi qua env, không cần deploy.
 */
export function modelGiamSat(env: NodeJS.ProcessEnv = process.env): string {
  return env.AI_MODEL_GIAM_SAT?.trim() || 'deepseek/deepseek-v4-flash';
}

/** Công tắc tắt khẩn (env AI_GIAM_SAT_TAT=1) — mặc định BẬT cho luồng nhân viên. */
export function giamSatDangBat(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AI_GIAM_SAT_TAT !== '1';
}
