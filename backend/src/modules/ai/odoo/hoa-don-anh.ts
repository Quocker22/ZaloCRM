// SPDX-License-Identifier: AGPL-3.0-or-later
// Render hóa đơn Odoo thành ẢNH PNG để gửi qua Zalo.
//
// VÌ SAO KHÔNG DÙNG XML-RPC: `ir.actions.report._render_qweb_pdf` là method
// PRIVATE (tên bắt đầu bằng `_`), Odoo chặn gọi từ xa —
//   "Private methods cannot be called remotely"
// Cùng rào cản đã gặp với `_build_low_stock_html`. Nhưng ở đây KHÔNG cần thêm
// method Odoo: endpoint HTTP `/report/pdf/<report>/<id>` đã public sẵn, chỉ cần
// một phiên đăng nhập web.
//
// VÌ SAO ẢNH CHỨ KHÔNG PDF: trên Zalo, PDF hiện ra ô file phải bấm tải mới xem
// được — nhân viên và khách hay bỏ qua. Ảnh hiện thẳng trong khung chat.
//
// ⚠️ CẢNH BÁO BẢO MẬT — ĐỌC TRƯỚC KHI DÙNG Ở LUỒNG KHÁCH:
// Report `report_saleorder_kiotviet` (bản đẹp của LEDNELIA) CÓ IN DƯ NỢ của
// khách. Vì vậy tool bọc nó CHỈ được đăng ký ở registry NHÂN VIÊN. Xem
// `bao-cao-hoa-don.ts`.

import { pdf } from 'pdf-to-img';
import sharp from 'sharp';

/**
 * "HH:mm dd/MM/yyyy" theo giờ Việt Nam, 24H — anh Quyết 16:49 24/08: nhiều
 * đơn giống nhau, kho không để ý là xót; "Để 24H nhé".
 *
 * Tự cộng +7 từ UTC thay vì tin TZ của máy: container đang chạy UTC, mà giờ
 * in lên hoá đơn phải là giờ Việt Nam bất kể server đặt ở đâu.
 */
export function chuoiThoiGianVn(luc: Date = new Date()): string {
  const vn = new Date(luc.getTime() + 7 * 3600_000);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(vn.getUTCHours())}:${p(vn.getUTCMinutes())} ` +
    `${p(vn.getUTCDate())}/${p(vn.getUTCMonth() + 1)}/${vn.getUTCFullYear()}`;
}

/**
 * Đóng dấu thời gian thực lên ảnh hoá đơn — bên PHẢI, NGANG HÀNG khối
 * "Số hoá đơn / Ngày" (anh Quốc 25/08 kèm ảnh khoanh vùng: "chuyển phần giờ
 * xuống chỗ khoanh đỏ, không cần highlight"). Chữ đen thường, không nền đỏ.
 *
 * Vị trí tính theo TỶ LỆ ảnh (không theo pixel cứng): đổi DO_PHONG hay khổ
 * giấy thì dấu vẫn nằm đúng vùng đầu trang bên phải.
 *
 * Dấu là PHỤ, ảnh là CHÍNH: mọi lỗi (ảnh hỏng, sharp thiếu) đều trả nguyên
 * ảnh gốc — thà thiếu giờ còn hơn kho không nhận được hoá đơn.
 */
export async function dongDauThoiGian(anh: Buffer, luc: Date = new Date()): Promise<Buffer> {
  try {
    const meta = await sharp(anh).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (!w || !h) return anh;
    const chu = `In lúc ${chuoiThoiGianVn(luc)}`;
    // Cỡ chữ ~ chữ thường của hoá đơn (đo ảnh scale 2: body ~22px trên khổ 1190).
    const coChu = Math.max(12, Math.round(w * 0.0185));
    // Neo phải cách mép ~5% (đúng mép vùng khoanh), cao ~22.4% — ngang dòng
    // "Số hoá đơn"/"Ngày ..." của template kiotviet.
    const dau = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<text x="${Math.round(w * 0.953)}" y="${Math.round(h * 0.224)}" text-anchor="end" ` +
      `font-family="DejaVu Sans, Arial, sans-serif" font-size="${coChu}" ` +
      `font-weight="600" fill="#1f1f1f">${chu}</text></svg>`,
    );
    return await sharp(anh)
      .composite([{ input: dau, top: 0, left: 0 }])
      .png()
      .toBuffer();
  } catch {
    return anh;
  }
}

/** Report mặc định — bản đẹp của LEDNELIA (logo, tiếng Việt, có dư nợ). */
export const REPORT_MAC_DINH = 'incokit_pos.report_saleorder_kiotviet';

/**
 * Report chuẩn Odoo cho PHIẾU NHẬP (purchase.order) — "Purchase Order".
 * Dùng khi gửi ảnh phiếu nhập qua chat (16/08, anh Quốc: "cũng chưa gửi được
 * hình hóa đơn lên như bán hàng á").
 */
export const REPORT_DON_MUA = 'purchase.report_purchaseorder';

/**
 * Độ phóng khi đổi PDF sang ảnh.
 *
 * 2 = chữ sắc nét trên điện thoại mà file vẫn ~180KB. Để 3 thì ~400KB, Zalo
 * nén lại thành mờ nên không được lợi gì.
 */
const DO_PHONG = 2;

/** Chỉ lấy trang đầu — hóa đơn 1 SP luôn gọn trong 1 trang. */
const TRANG_TOI_DA = 1;

export interface HoaDonAnhConfig {
  /** Gốc URL Odoo, vd http://localhost:8069 */
  url: string;
  db: string;
  username: string;
  password: string;
  /** Trần chờ tải PDF. Odoo render qweb khá chậm với đơn nhiều dòng. */
  timeoutMs?: number;
}

export class HoaDonAnhError extends Error {
  constructor(message: string, readonly nguyenNhan?: unknown) {
    super(message);
    this.name = 'HoaDonAnhError';
  }
}

export interface AnhHoaDon {
  /** Nội dung PNG. */
  duLieu: Buffer;
  /** Tên file gợi ý khi lưu ra đĩa. */
  tenFile: string;
}

/**
 * Phiên đăng nhập web Odoo.
 *
 * Tách khỏi `OdooClient` (XML-RPC) vì đây là cơ chế khác hẳn: cookie session
 * thay vì uid+password mỗi lần gọi. Cookie được nhớ lại giữa các lần render —
 * đăng nhập lại cho từng hóa đơn là phí một round-trip.
 */
export class HoaDonAnhClient {
  private cookie: string | null = null;

  constructor(private readonly cfg: HoaDonAnhConfig) {}

  /** Đăng nhập web, nhớ cookie. Trả cookie để dùng lại. */
  private async dangNhap(): Promise<string> {
    if (this.cookie) return this.cookie;

    const res = await fetch(`${this.cfg.url}/web/session/authenticate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        params: { db: this.cfg.db, login: this.cfg.username, password: this.cfg.password },
      }),
      signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 30_000),
    });

    const body = (await res.json()) as { result?: { uid?: number }; error?: unknown };
    if (!body?.result?.uid) {
      throw new HoaDonAnhError('Đăng nhập Odoo thất bại — kiểm tra ODOO_USERNAME/PASSWORD');
    }

    // Odoo trả nhiều Set-Cookie; chỉ cần session_id.
    const raw = res.headers.getSetCookie?.() ?? [];
    const sid = raw.map((c) => c.split(';')[0]).find((c) => c.startsWith('session_id='));
    if (!sid) throw new HoaDonAnhError('Odoo không trả session_id');

    this.cookie = sid;
    return sid;
  }

  /** Xoá cookie đã nhớ — dùng khi phiên hết hạn. */
  resetPhien(): void {
    this.cookie = null;
  }

  /** Tải PDF hóa đơn. */
  async taiPdf(donId: number, report = REPORT_MAC_DINH): Promise<Buffer> {
    const goi = async (cookie: string) =>
      fetch(`${this.cfg.url}/report/pdf/${report}/${donId}`, {
        headers: { cookie },
        // Render qweb→PDF chậm hơn hẳn một truy vấn thường.
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 90_000),
      });

    let res = await goi(await this.dangNhap());

    // Phiên hết hạn → Odoo chuyển hướng về trang đăng nhập (trả HTML, không
    // phải lỗi HTTP). Thử lại MỘT lần với phiên mới.
    const laHtml = (res.headers.get('content-type') ?? '').includes('text/html');
    if (res.status === 401 || res.status === 403 || laHtml) {
      this.resetPhien();
      res = await goi(await this.dangNhap());
    }

    if (!res.ok) {
      throw new HoaDonAnhError(`Odoo trả ${res.status} khi render hóa đơn đơn ${donId}`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    // Kiểm magic: Odoo có thể trả trang lỗi HTML với status 200.
    if (!buf.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw new HoaDonAnhError(
        `Odoo không trả PDF cho đơn ${donId} (có thể đơn không tồn tại hoặc thiếu quyền)`,
      );
    }
    return buf;
  }

  /** Tải hóa đơn và đổi sang ảnh PNG. */
  async render(donId: number, maDon?: string, report = REPORT_MAC_DINH): Promise<AnhHoaDon> {
    const pdfBuf = await this.taiPdf(donId, report);

    let doc;
    try {
      doc = await pdf(pdfBuf, { scale: DO_PHONG });
    } catch (err) {
      throw new HoaDonAnhError('Không đổi được PDF sang ảnh', err);
    }

    let i = 0;
    for await (const trang of doc) {
      if (++i > TRANG_TOI_DA) break;
      return {
        // Đóng dấu giờ thực 24H lên ảnh (anh Quyết 24/08) — kho phân biệt
        // được các đơn giống nhau, xót đơn thì soi giờ mà truy.
        duLieu: await dongDauThoiGian(Buffer.from(trang)),
        // Tên có mã đơn để nhân viên lưu về còn nhận ra.
        tenFile: `hoa-don-${maDon ?? donId}.png`,
      };
    }
    throw new HoaDonAnhError(`PDF đơn ${donId} không có trang nào`);
  }
}

/**
 * action id của menu Đơn bán trong Odoo — thành phần của link `/web#...`.
 *
 * Anh cung cấp 2026-07-31 từ link thật đang dùng:
 *   /web#id=26704&cids=1&menu_id=371&action=515&model=sale.order&view_type=form
 *
 * Cho phép ghi đè qua env vì id action/menu khác nhau giữa các bản cài Odoo —
 * đem sang máy khác mà không đổi thì link mở nhầm menu.
 */
const ACTION_DON_BAN = Number(process.env.ODOO_ACTION_SALE_ORDER ?? 515);
const MENU_DON_BAN = Number(process.env.ODOO_MENU_SALE_ORDER ?? 371);

/**
 * Link backend Odoo để nhân viên bấm vào xử lý đơn.
 *
 * Dùng dạng `/web#id=...&action=...&model=sale.order&view_type=form` thay vì
 * `/odoo/sale/<id>`: đây là link anh đang dùng thật trong app, mở đúng form chi
 * tiết kèm ngữ cảnh menu (breadcrumb, nút Xác nhận). Dạng `/odoo/sale/<id>` tuy
 * ngắn nhưng mất phần menu nên thao tác tiếp bị cụt.
 *
 * Cần đăng nhập Odoo nên chỉ nhân viên mở được; KHÔNG dùng link portal
 * `/my/orders/...` vì ai có link cũng xem được.
 */
export function linkXuLyDon(odooUrl: string, donId: number): string {
  const goc = odooUrl.replace(/\/+$/, '');
  return (
    `${goc}/web#id=${donId}&cids=1&menu_id=${MENU_DON_BAN}` +
    `&action=${ACTION_DON_BAN}&model=sale.order&view_type=form`
  );
}

/**
 * Link backend Odoo tới PHIẾU NHẬP HÀNG (đơn mua) — ca thật 22:09-22:11 11/08.
 *
 * DẠNG KHÁC đơn bán, có lý do: link đơn bán ghim `action`/`menu_id` lấy từ link
 * thật anh Quốc gửi. Với đơn mua ta KHÔNG có con số đó — tài khoản bot_zalo bị
 * chặn đọc `ir.actions.act_window` (đo prod 11/08: faultCode 4 "Liên hệ quản
 * trị viên để yêu cầu quyền truy cập"), nên đoán bừa một id là ra link mở nhầm
 * menu.
 *
 * Dạng `/odoo/purchase/<id>` là router chuẩn của Odoo 17: không cần biết
 * action/menu, tự mở đúng form chi tiết kèm nút Xác nhận. Mất phần breadcrumb
 * so với dạng `/web#...` — chấp nhận được, đổi lại link luôn đúng.
 *
 * Vẫn cho ghi đè qua env: bản cài khác có thể cần dạng cũ.
 */
/**
 * Action "Danh sách phiếu nhập" trên Odoo prod (đo 16/08: ir.actions.act_window
 * id=482, action custom của incokit). Cùng lối hardcode-theo-instance với
 * ACTION_DON_BAN của đơn bán; env override khi Odoo đổi.
 */
const ACTION_DON_MUA_MAC_DINH = 482;

export function linkXuLyDonMua(odooUrl: string, donId: number): string {
  const goc = odooUrl.replace(/\/+$/, '');
  // Dạng `/odoo/purchase/<id>` (fallback cũ) HỎNG trên bản Odoo này — anh Quốc
  // 16/08: "link .../vi/odoo/purchase/14592 cũng sai nhé" (website còn chêm
  // tiền tố ngôn ngữ /vi/ vào). Dạng /web# giống hệt link đơn bán ĐANG chạy —
  // dùng nó luôn, không giữ fallback hỏng.
  const action = Number(process.env.ODOO_ACTION_PURCHASE_ORDER ?? 0) || ACTION_DON_MUA_MAC_DINH;
  const menu = Number(process.env.ODOO_MENU_PURCHASE_ORDER ?? 0);
  return (
    `${goc}/web#id=${donId}&cids=1${menu > 0 ? `&menu_id=${menu}` : ''}` +
    `&action=${action}&model=purchase.order&view_type=form`
  );
}
