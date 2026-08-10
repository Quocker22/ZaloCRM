// SPDX-License-Identifier: AGPL-3.0-or-later
// ĐỌC ẢNH — bot nhìn ảnh rồi mô tả thành CHỮ, để luồng thường xử tiếp.
//
// Anh Quốc 10/08: "làm bot đọc được ảnh". Khi tôi tự thu hẹp thành "ảnh chuyển
// khoản", anh chỉnh ngay: "ai nói bạn là đọc ảnh chuyển khoản????, chỉ đọc ảnh
// rồi lấy thông tin xử lý thôi" — MỌI loại ảnh: ảnh sản phẩm, ảnh danh sách
// hàng viết tay, ảnh biên lai. Đọc xong đưa vào luồng bình thường, KHÔNG phân
// loại trước rồi chỉ xử một loại.
//
// KIẾN TRÚC: ảnh → chữ → luồng cũ. Không đụng gì tới máy gom đơn, tool Odoo,
// hay luồng khách; chúng chỉ thấy một câu chữ như mọi khi. Nhờ vậy toàn bộ
// nghiệp vụ (tra khách, chốt SP, giá NV báo) tự động dùng được với ảnh mà
// không phải viết lại đường nào.
//
// VÌ SAO MODEL RIÊNG: đo thật 10/08 — model prod `deepseek-v4-flash-0731`
// KHÔNG nhìn được ảnh, OpenRouter trả 404 "No endpoints found that support
// image input". A/B 9 model trên ảnh biên lai (số tiền/tên/STK/nội dung):
//   gpt-4.1-mini            4/4 · 2,8s  ← chọn mặc định
//   gemini-2.5-flash-lite   4/4 · 2,1s
//   qwen3-vl-30b            4/4 · 4,0s
//   mistral-small-3.2       4/4 · 5,6s
//   gpt-4.1-nano            1/4        ✗
//   các con :free           0/4        ✗ (một con nói lảm nhảm về "dịch thuật")
//
// Vòng 2 (anh Quốc đề xuất mimo), thêm ảnh ĐƠN HÀNG viết tay — sát việc thật
// hơn biên lai, vì mã SP mới là thứ bot cần để chốt đúng hàng:
//   gemini-2.5-flash-lite   8/8 ·  3,0s
//   gpt-4.1-mini            8/8 ·  5,4s
//   xiaomi/mimo-v2.5        7/8 · 26,4s  ✗ sót mã "12V300W", chậm gấp 5-9 lần
// Mimo đọc biên lai đúng 4/4 nhưng sót mã SP và 26s là quá lâu (trần xử lý
// 90s). Đổi được bằng env AI_MODEL_DOC_ANH nếu muốn thử lại.
// Chi phí đo thật: ~5,2đ/ảnh → ~780đ/tháng ở 5 ảnh/ngày. Không đáng kể, nên
// chọn theo ĐỘ TIN CẬY chứ không theo giá.
import { logger } from '../../../../shared/utils/logger.js';

/** Loại tin gửi cho model nhìn được. Voice/video/file vẫn đi đường báo người. */
const LOAI_ANH = new Set(['image', 'photo']);

/** Model nhìn ảnh — đổi được bằng env, không cần deploy. */
export function modelDocAnh(env: NodeJS.ProcessEnv = process.env): string {
  return env.AI_MODEL_DOC_ANH?.trim() || 'openai/gpt-4.1-mini';
}

/** Trần kích thước ảnh tải về (MB) — ảnh Zalo thường 15-500KB. */
const TRAN_MB = 8;

export function laLoaiDocDuoc(contentType: string): boolean {
  return LOAI_ANH.has(contentType);
}

/**
 * URL ảnh nằm trong cột `content` của tin — zca-js lưu JSON
 * `{title, description, href, thumb, ...}`, trong đó `title` là câu chú thích
 * người gửi gõ kèm ảnh.
 *
 * Lấy `href` trước, `thumb` sau (thumb nhỏ hơn, model đọc chữ kém hơn). KHÔNG
 * quét URL trong toàn chuỗi: `title` có thể chứa chữ "http" trong câu nói của
 * khách và ta sẽ bốc nhầm.
 */
export function bocUrlAnh(content: string): string | null {
  const c = String(content ?? '').trim();
  if (!c) return null;

  if (/^https?:\/\/\S+$/i.test(c)) return c;

  try {
    const o = JSON.parse(c) as Record<string, unknown>;
    for (const khoa of ['href', 'thumb']) {
      const v = o[khoa];
      if (typeof v === 'string' && /^https?:\/\//i.test(v)) return v;
    }
  } catch {
    // Không phải JSON — không cố đoán thêm, trả null để caller đi đường cũ.
  }
  return null;
}

/** Câu chú thích người gửi gõ kèm ảnh (nếu có) — cũng là ngữ cảnh cần đọc. */
export function bocChuThich(content: string): string {
  try {
    const o = JSON.parse(String(content ?? '')) as Record<string, unknown>;
    const t = o.title;
    return typeof t === 'string' ? t.trim() : '';
  } catch {
    return '';
  }
}

export interface DocAnhDeps {
  /** Gọi thẳng provider — không qua ToolAwareGenerate vì cần gửi content block. */
  goiModel: (args: {
    model: string;
    anhBase64: string;
    kieuAnh: string;
    chuThich: string;
  }) => Promise<string>;
  taiAnh?: (url: string) => Promise<{ duLieu: Buffer; kieu: string } | null>;
}

/** Tải ảnh về dạng base64 để nhét vào data: URI. */
async function taiAnhMacDinh(url: string): Promise<{ duLieu: Buffer; kieu: string } | null> {
  const res = await fetch(url);
  if (!res.ok) {
    logger.warn({ url, status: res.status }, '[doc-anh] tải ảnh lỗi');
    return null;
  }
  const kieu = res.headers.get('content-type') ?? 'image/jpeg';
  if (!kieu.startsWith('image/')) {
    logger.warn({ url, kieu }, '[doc-anh] không phải ảnh');
    return null;
  }
  const duLieu = Buffer.from(await res.arrayBuffer());
  if (duLieu.length > TRAN_MB * 1024 * 1024) {
    logger.warn({ url, mb: (duLieu.length / 1048576).toFixed(1) }, '[doc-anh] ảnh quá lớn');
    return null;
  }
  return { duLieu, kieu };
}

/**
 * Nhìn ảnh, trả về MÔ TẢ BẰNG CHỮ để luồng thường xử tiếp.
 *
 * `null` = không đọc được (tải lỗi, model lỗi, ảnh hỏng) → caller đi đường cũ
 * (báo nhân viên), tuyệt đối không im lặng.
 */
export async function docAnh(
  deps: DocAnhDeps,
  input: { url: string; chuThich?: string },
): Promise<string | null> {
  try {
    const tai = deps.taiAnh ?? taiAnhMacDinh;
    const anh = await tai(input.url);
    if (!anh) return null;

    const mo = await deps.goiModel({
      model: modelDocAnh(),
      anhBase64: anh.duLieu.toString('base64'),
      kieuAnh: anh.kieu,
      chuThich: (input.chuThich ?? '').trim(),
    });
    const sach = String(mo ?? '').trim();
    return sach || null;
  } catch (err) {
    logger.warn({ err, url: input.url }, '[doc-anh] đọc ảnh lỗi — nhường đường báo người');
    return null;
  }
}

/**
 * Lời dặn model khi nhìn ảnh.
 *
 * Cố ý KHÔNG bắt model phân loại ("đây có phải biên lai không") rồi mới đọc:
 * anh Quốc muốn đọc MỌI ảnh. Cứ mô tả đủ thứ nhìn thấy, luồng sau tự dùng
 * phần nó cần.
 *
 * Nhấn "ghi nguyên văn số": đo thật cho thấy model hay làm tròn tiền
 * (5.400.000 → "5,4 triệu"), mà số tiền sai một chữ là sai sổ sách.
 */
export function loiDanDocAnh(chuThich: string): string {
  const dan = [
    'Đọc ảnh này và ghi lại MỌI thông tin nhìn thấy, bằng tiếng Việt, ngắn gọn.',
    'Có chữ/số trong ảnh thì chép NGUYÊN VĂN, KHÔNG làm tròn, KHÔNG diễn giải lại',
    '(vd "5.400.000" giữ nguyên, đừng viết "5,4 triệu").',
    'Nếu là biên lai/hoá đơn: nêu số tiền, người nhận, số tài khoản, nội dung.',
    'Nếu là sản phẩm: mô tả loại hàng, mã/thông số in trên ảnh.',
    'Nếu là danh sách/đơn viết tay: chép lại từng dòng.',
    'KHÔNG đoán thứ không có trong ảnh.',
  ];
  if (chuThich) dan.push(`Người gửi kèm lời nhắn: "${chuThich}".`);
  return dan.join(' ');
}
