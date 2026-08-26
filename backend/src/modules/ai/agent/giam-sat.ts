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
}

export interface DauVaoGiamSat {
  cauNv: string;
  lichSu: Array<{ vai: 'nhanvien' | 'bot' | 'khach'; noiDung: string }>;
  log: ToolCallLog[];
  traLoi: string;
}

/** Mặc định 8s — quá thì gửi bản gốc, NV không phải chờ máy soi. */
export const TIMEOUT_GIAM_SAT_MS = 8_000;
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
].join('\n');

export async function giamSatTraLoi(
  generate: ToolAwareGenerate,
  vao: DauVaoGiamSat,
  timeoutMs: number = TIMEOUT_GIAM_SAT_MS,
): Promise<PhanQuyet> {
  const t0 = Date.now();
  const dongChep = dongDanModelBiChep(vao.traLoi, vao.log);
  const goiY = dongChep.length > 0
    ? `\nCODE PHÁT HIỆN: bản nháp chép nguyên ${dongChep.length} dòng dặn-model từ output tool → chắc chắn lo_noi_bo.`
    : '';
  const userMessage =
    `LỊCH SỬ GẦN NHẤT:\n${hienLichSu(vao.lichSu)}\n\n` +
    `CÂU NHÂN VIÊN VỪA GỬI: "${vao.cauNv}"\n\n` +
    `TOOL BOT ĐÃ GỌI LƯỢT NÀY:\n${hienTool(vao.log)}\n\n` +
    `BẢN NHÁP BOT ĐỊNH GỬI:\n"""${vao.traLoi}"""${goiY}`;

  const failOpen = (lyDo: string): PhanQuyet => {
    // Không có model thì ít nhất lột dòng dặn-model bị chép (hàng rào tối thiểu).
    const sua = dongChep.length > 0 ? botDongBiChep(vao.traLoi, dongChep) : undefined;
    return {
      ok: !sua, loi: sua ? ['lo_noi_bo'] : [], ...(sua ? { traLoiSua: sua } : {}),
      lyDo, nguon: 'fail_open', ms: Date.now() - t0,
    };
  };

  try {
    const turn = await Promise.race([
      generate({ system: SYSTEM, messages: [{ role: 'user', content: userMessage }], tools: [phanQuyetDefinition], maxTokens: 700 }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`giám sát quá ${timeoutMs}ms`)), timeoutMs)),
    ]);
    const call = turn.toolCalls.find((c) => c.name === 'phan_quyet');
    if (!call) return failOpen('model không gọi phan_quyet');
    const raw = call.input as Record<string, unknown>;
    const loi = (Array.isArray(raw.loi) ? raw.loi : []).filter((x): x is MaLoi => (MA_LOI as readonly string[]).includes(String(x)));
    const ok = raw.ok === true && loi.length === 0;
    const sua = typeof raw.tra_loi_sua === 'string' ? raw.tra_loi_sua.trim() : '';
    // Nói có lỗi mà không đưa bản sửa → không tin, gửi bản gốc (đã lột dòng chép).
    if (!ok && sua.length < 5) return failOpen('model báo lỗi nhưng không đưa bản sửa');
    // Bản sửa vẫn còn dòng dặn-model → lột nốt bằng code.
    const suaSach = ok ? undefined : botDongBiChep(sua, dongDanModelBiChep(sua, vao.log));
    return {
      ok, loi, ...(suaSach ? { traLoiSua: suaSach } : {}),
      ...(typeof raw.ly_do === 'string' ? { lyDo: raw.ly_do.slice(0, 300) } : {}),
      nguon: 'llm', ms: Date.now() - t0,
    };
  } catch (err) {
    logger.warn({ err }, '[giam-sat] lỗi/timeout — fail-open gửi bản gốc');
    return failOpen(err instanceof Error ? err.message : String(err));
  }
}

/** Model giám sát — KHÁC model chính; đổi qua env, không cần deploy. */
export function modelGiamSat(env: NodeJS.ProcessEnv = process.env): string {
  return env.AI_MODEL_GIAM_SAT?.trim() || 'openai/gpt-4.1-mini';
}

/** Công tắc tắt khẩn (env AI_GIAM_SAT_TAT=1) — mặc định BẬT cho luồng nhân viên. */
export function giamSatDangBat(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AI_GIAM_SAT_TAT !== '1';
}
