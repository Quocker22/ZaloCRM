// SPDX-License-Identifier: AGPL-3.0-or-later
// Luồng KHÁCH HÀNG dùng tool-calling — song song với luồng nhân viên (staff-agent).
//
// KHÁC BIỆT CỐT LÕI so với staff-agent:
//
//   | | Nhân viên | Khách hàng |
//   |---|---|---|
//   | Ngôn từ | ngắn, kỹ thuật | lịch sự, có "dạ/ạ" |
//   | Được tạo đơn | CÓ | KHÔNG — chỉ chốt rồi chuyển sale |
//   | Thấy id nội bộ | CÓ | KHÔNG — tuyệt đối không lộ |
//   | Thấy công nợ | CÓ | KHÔNG |
//   | Bí thì | chuyển sale | chuyển sale (nhưng nói mềm hơn) |
//
// VÌ SAO khách KHÔNG được tạo đơn: khách nói "5 cái" có thể là thăm dò, chưa chốt.
// Sale phải xác nhận. Bot chỉ tra giá/tồn và chuyển sale khi khách muốn mua.

import { runAgent } from './loop.js';
import { ToolRegistry } from './registry.js';
import type { ToolAwareGenerate, TurnUsage } from './types.js';
import type { ToolCallLog } from './staff-agent.js';

import type { OdooClient } from '../odoo/client.js';
import {
  taoKhachHang, taoKhachHangDefinition, dinhDangTaoKhach,
} from '../odoo/tools/tao-khach-hang.js';
import {
  taoDonNhap, taoDonNhapDefinition, dinhDangTaoDon,
} from '../odoo/tools/tao-don-nhap.js';
import {
  traSanPham, traSanPhamDefinition, dinhDangSanPham,
} from '../odoo/tools/tra-san-pham.js';
import {
  chuyenSale, chuyenSaleDefinition, dinhDangChuyenSale,
  type YeuCauChuyenSale,
} from '../odoo/tools/chuyen-sale.js';
import {
  traDanhMuc, traDanhMucDefinition, dinhDangDanhMuc,
} from '../odoo/tools/tra-danh-muc.js';
import {
  traTriThuc, traTriThucDefinition, dinhDangTriThuc,
} from '../odoo/tools/tra-tri-thuc.js';
import {
  guiTaiLieu, guiTaiLieuDefinition, dinhDangGuiTaiLieu, khoiNoiDungKemFile, type TaiLieu,
} from '../odoo/tools/gui-tai-lieu.js';
import { findImageForReply } from '../knowledge/product-image.js';
import { khoiMucLucChoPrompt } from '../knowledge/muc-luc.js';
import { laYDinhDung, khoeDaGuiTaiLieu, coBangChungGuiFile } from './y-dinh-dung.js';
import { matchGuidelines, type KetQuaMatch } from './guideline-matcher.js';
import { lapPromptKhach, tinhToolChoPhep, type GuidelineActive } from './guideline-prompt.js';

export interface CustomerAgentDeps {
  odoo: OdooClient;
  generate: ToolAwareGenerate;
  /** Cho khách tự chốt đơn. Thiếu → bot chỉ tư vấn, chuyển sale khi khách muốn mua. */
  choKhachChotDon?: {
    conversationId: string;
    seq: number;
    zaloUid?: string | null;
    tranTien: number;
    /** Chặn đơn thứ hai quá gần đơn trước trong cùng hội thoại (giây). */
    chanDonLienKeGiay?: number;
  };
  ghiNhanChuyenSale: (yc: YeuCauChuyenSale) => Promise<void>;
  ghiLog?: (log: ToolCallLog) => Promise<void> | void;
  /** Tra tài liệu kỹ thuật. Không truyền thì tool `tra_tri_thuc` không đăng ký. */
  timDoanTriThuc?: (cauHoi: string, soDoan: number) => Promise<Array<{ content: string; score?: number }>>;
  /**
   * Kho tài liệu (catalog/datasheet PDF) gửi được cho khách. Không truyền thì
   * tool `gui_tai_lieu` không đăng ký — khỏi hứa gửi rồi không gửi được.
   */
  lietTaiLieu?: () => Promise<TaiLieu[]>;
  /** Trích nội dung thô của tài liệu (RAG) để nhắn kèm tóm tắt sau khi gửi file. */
  trichTaiLieu?: (tieuDe: string) => Promise<string | null>;
  /** Mục lục sản phẩm sinh từ sheet (nhóm B 15/08) — chèn đầu userMessage. */
  mucLucSp?: string;
  /**
   * Guideline engine (docs/THIET-KE-GUIDELINE-ENGINE.md). Không truyền = 'off'
   * — prompt tĩnh, đúng hành vi cũ từng byte.
   *
   * 'shadow': matcher chạy + ghi log để soát, nhưng prompt/registry KHÔNG đổi.
   * 'on'    : prompt lắp từ guideline active; tool bị gate theo guideline.
   */
  guidelineEngine?: {
    mode: 'shadow' | 'on';
    guidelines: GuidelineNap[];
    /** Ghi GuidelineMatchLog. Lỗi bị nuốt — quan trắc không được phá nghiệp vụ. */
    ghiMatchLog?: (log: {
      message: string;
      stage: string;
      matchedIds: string[];
      durationMs: number;
      fallback: boolean;
    }) => void | Promise<void>;
  };
}

/** Guideline nạp từ DB (đã lọc enabled + yeuCau ở caller — xem locTheoPhien). */
export interface GuidelineNap extends Omit<GuidelineActive, 'id'> {
  /** Slug người đọc được — dùng làm id trong matcher và trong match log. */
  ten: string;
  condition: string;
  stage?: string | null;
  yeuCau?: string | null;
}

export interface CustomerAgentInput {
  bizName: string;
  /** Tin khách vừa gửi. */
  message: string;
  /** Lịch sử hội thoại (cũ → mới) để bot hiểu ngữ cảnh. */
  history?: Array<{ vai: 'khach' | 'shop'; noiDung: string }>;
  maxIterations?: number;
}

export type CustomerAgentResult =
  | {
      trangThai: 'xong'; traLoi: string; log: ToolCallLog[]; usage: TurnUsage;
      /**
       * Đường dẫn ảnh sản phẩm để caller đính kèm vào tin Zalo.
       *
       * KHÔNG làm thành tool: model không cần quyết định gửi ảnh hay không —
       * cứ nhắc đúng tên một SP có ảnh là gửi. Luồng cũ (auto-reply-wiring)
       * đã làm đúng như vậy; luồng agent mới bỏ sót nên ảnh không bao giờ gửi
       * dù kho có 250 ảnh / 232 SP (bug thật 2026-08-02).
       */
      anhSanPham?: string;
      /** Đơn vừa tạo (chỉ khi bật cho khách tự chốt) — caller gửi QR. */
      don?: { donId: number; maDon: string; tongTien: number; tenKhach: string };
      /**
       * File tài liệu bot đã lấy được (tool `gui_tai_lieu`) — caller gửi qua
       * Zalo sau phần text. File KHÔNG đi qua LLM: nó không đọc được PDF nhị
       * phân và vài MB base64 nuốt sạch ngữ cảnh.
       */
      taiLieu?: Array<{ tieuDe: string; duongDanCucBo: string }>;
    }
  | { trangThai: 'chua_hoan_tat'; lyDo: string; log: ToolCallLog[]; usage: TurnUsage };

/**
 * Registry cho luồng khách — 4 tool (5 khi có tài liệu kỹ thuật).
 *
 * KHÔNG có:
 *  - `tao_don_nhap` — khách không được tạo đơn, sale phải chốt
 *  - `tra_khach_hang` — lộ công nợ + tên khách khác nếu trùng SĐT
 *  - 3 tool báo cáo — doanh thu/lợi nhuận là thông tin nội bộ
 *  - `tra_ton_kho` — BỎ 2026-08-02 theo quyết định của anh: với khách thì LUÔN
 *    báo còn hàng, chuẩn bị hàng là việc của nhân viên. Giữ tool này chỉ tổ
 *    tốn một vòng gọi rồi bỏ kết quả (đo thật: bot vẫn gọi rồi lờ đi).
 */
export function buildCustomerRegistry(deps: {
  odoo: OdooClient;
  ghiNhanChuyenSale: (yc: YeuCauChuyenSale) => Promise<void>;
  /**
   * Cho khách TỰ chốt đơn. Thiếu → hai tool ghi KHÔNG đăng ký (mặc định cũ).
   *
   * MỞ RANH GIỚI BẢO MẬT: khách điều khiển được câu chữ nên cũng điều khiển
   * được việc ghi vào Odoo. Hàng rào phải nằm trong CODE, không phải prompt —
   * khách lèo lái được prompt.
   */
  choKhachChotDon?: {
    conversationId: string;
    seq: number;
    /** UID Zalo khách — khoá chống trùng khi tạo khách mới. */
    zaloUid?: string | null;
    /** Trần tiền một đơn. Vượt → chuyển sale. */
    tranTien: number;
    /** Chặn đơn thứ hai quá gần đơn trước trong cùng hội thoại (giây). */
    chanDonLienKeGiay?: number;
    /** Nhận đơn vừa tạo — caller dùng để gửi hoá đơn + QR. */
    nhanDon?: (don: { donId: number; maDon: string; tongTien: number; tenKhach: string }) => void;
  };
  /** Tra tài liệu kỹ thuật. Không truyền thì tool không đăng ký. */
  timDoanTriThuc?: (cauHoi: string, soDoan: number) => Promise<Array<{ content: string; score?: number }>>;
  /**
   * Liệt kê tài liệu (catalog/datasheet PDF) gửi được cho khách. Không truyền
   * thì tool `gui_tai_lieu` không đăng ký. Danh sách trả về ĐÃ qua `locGiaNoiBo`.
   */
  lietTaiLieu?: () => Promise<TaiLieu[]>;
  /** Trích nội dung thô của tài liệu (RAG) để nhắn kèm tóm tắt sau khi gửi file. */
  trichTaiLieu?: (tieuDe: string) => Promise<string | null>;
  /** Mục lục sản phẩm sinh từ sheet (nhóm B 15/08) — chèn đầu userMessage. */
  mucLucSp?: string;
  /** Tải tài liệu về đường dẫn cục bộ. Mặc định dùng `taiTaiLieuVe` của kho. */
  taiTaiLieu?: (t: TaiLieu) => Promise<string>;
  /** Nhận file tài liệu đã tải — caller gửi qua Zalo sau phần text. */
  nhanTaiLieu?: (t: { tieuDe: string; duongDanCucBo: string }) => void;
  /**
   * Guideline engine mode 'on': chỉ tool trong bộ này được đăng ký. Không
   * truyền = không gate (hành vi cũ). Tầng chặn NẰM DƯỚI prompt: matcher không
   * match guideline chốt đơn thì tool ghi không tồn tại trong registry — model
   * không gọi nổi, kể cả bị prompt injection dụ. Các hàng rào cũ (laYDinhDung,
   * trần tiền, idempotency) vẫn chặn tiếp ở executor, không thay nhau.
   */
  toolChoPhep?: ReadonlySet<string>;
}): ToolRegistry {
  const { odoo } = deps;
  const duocPhep = (ten: string) => !deps.toolChoPhep || deps.toolChoPhep.has(ten);
  const r = new ToolRegistry();
  // Trả lời được "bên bạn bán gì" — câu mở đầu phổ biến nhất của khách buôn.
  // Thiếu tool này thì bot phải đoán từ khoá rồi chuyển sale (bug 2026-07-30).
  if (duocPhep('tra_danh_muc')) {
    r.register({
      definition: traDanhMucDefinition,
      run: async (input) =>
        dinhDangDanhMuc(await traDanhMuc({ odoo }, input as { tu_khoa?: string })),
    });
  }
  r
    .register({
      definition: traSanPhamDefinition,
      run: async (input) => {
        const i = input as { ten: string; gioi_han?: number };
        // Truyền lại từ khoá để thông báo rỗng phân biệt được "id nhét nhầm
        // vào ô ten" với "không tìm thấy thật".
        return dinhDangSanPham(await traSanPham({ odoo }, i), i.ten);
      },
    })
    .register({
      definition: chuyenSaleDefinition,
      run: async (input) =>
        dinhDangChuyenSale(
          await chuyenSale(
            { ghiNhan: deps.ghiNhanChuyenSale },
            input as { ly_do: string; tom_tat: string },
          ),
        ),
    });

  // Khách CŨNG được hỏi bảo hành / thông số — tri thức kỹ thuật không nhạy cảm
  // như giá vốn hay công nợ. Tool tự chặn câu hỏi về TIỀN ở tầng code.
  // (tra_tri_thuc thuộc TOOL_NEN nên không bị gate — vẫn cần timDoanTriThuc.)
  if (deps.timDoanTriThuc && duocPhep('tra_tri_thuc')) {
    r.register({
      definition: traTriThucDefinition,
      run: async (input) =>
        dinhDangTriThuc(
          await traTriThuc({ timDoan: deps.timDoanTriThuc! }, input as { cau_hoi: string }),
        ),
    });
  }

  // GỬI FILE TÀI LIỆU cho KHÁCH (11/08/2026) — anh Quốc chốt: "nếu như khách
  // yêu cầu gửi pdf thì phải gửi luôn nhé".
  //
  // VÌ SAO MỞ CHO KHÁCH, cùng lý lẽ đã áp cho `tra_tri_thuc`: datasheet là tài
  // liệu kỹ thuật CÔNG KHAI của nhà sản xuất — khách mua LED cần xem thông số
  // trước khi chốt, đó là chuyện bán hàng bình thường. Đã soát nội dung thật
  // của cả 8 file trên prod (11/08): 0/8 file dính từ khoá giá nội bộ ("agent
  // price", "vip price", "project price", "giá vốn", "giá nhập", "cost price",
  // "wholesale price").
  //
  // NHƯNG "hôm nay sạch" KHÔNG phải hàng rào — kho file lấy từ bảng `messages`
  // nên nhân viên gửi "Bang gia dai ly.pdf" vào nhóm là nó tự vào kho. Hàng rào
  // thật là `locGiaNoiBo` chạy trong `lietKeTaiLieu`, TRƯỚC khi tool nhìn thấy
  // bất cứ file nào: chỉ .pdf, và loại mọi tên file dính từ khoá giá.
  //
  // Đối xứng với `tra_tri_thuc`: cùng chịu gate guideline, cùng tắt khi không
  // có nguồn dữ liệu.
  if (deps.lietTaiLieu && duocPhep('gui_tai_lieu')) {
    const liet = deps.lietTaiLieu;
    const taiVe = deps.taiTaiLieu ?? (async (t: TaiLieu) => {
      const { taiTaiLieuVe } = await import('../knowledge/kho-tai-lieu.js');
      return taiTaiLieuVe(t);
    });
    r.register({
      definition: guiTaiLieuDefinition,
      run: async (input) => {
        const kq = await guiTaiLieu({ liet, taiVe }, input as { yeu_cau: string });
        // File KHÔNG đi qua LLM: nó không đọc được PDF nhị phân, và vài MB
        // base64 nuốt sạch ngữ cảnh — cùng lý do ảnh hoá đơn đi đường riêng.
        if (kq.loai === 'da_gui') {
          deps.nhanTaiLieu?.({ tieuDe: kq.taiLieu.tieuDe, duongDanCucBo: kq.duongDanCucBo });
        }
        let ra = dinhDangGuiTaiLieu(kq);
        // Kèm trích nội dung cho tin báo gửi file đỡ cụt ngủn (17:41 13/08) —
        // kho đã qua locGiaNoiBo nên trích ra cũng là datasheet công khai.
        if (kq.loai === 'da_gui' && deps.trichTaiLieu) {
          const trich = await deps.trichTaiLieu(kq.taiLieu.tieuDe).catch(() => null);
          if (trich) ra += khoiNoiDungKemFile(trich);
        }
        return ra;
      },
    });
  }

  // Hai tool GHI — chỉ đăng ký khi được bật rõ ràng VÀ (nếu có gate) guideline
  // chốt đơn đang active. Không bật thì registry giữ nguyên như cũ: khách
  // không chạm được vào việc ghi Odoo.
  const chot = deps.choKhachChotDon;
  if (chot && duocPhep('tao_don_nhap') && duocPhep('tao_khach_hang')) {
    // Tên khách gần nhất — dùng làm nội dung chuyển khoản trên QR. Bám theo
    // tool tạo khách vì đó là nơi duy nhất biết tên thật.
    let tenKhachGanNhat = '';
    r.register({
      definition: taoKhachHangDefinition,
      run: async (input) => {
        const kq = await taoKhachHang(
          { odoo, zaloUid: chot.zaloUid },
          input as Parameters<typeof taoKhachHang>[1],
        );
        if (kq.trangThai === 'ok') tenKhachGanNhat = kq.khach.ten;
        return dinhDangTaoKhach(kq);
      },
    }).register({
      definition: taoDonNhapDefinition,
      run: async (input) => {
        const kq = await taoDonNhap(
          {
            odoo,
            conversationId: chot.conversationId,
            seq: chot.seq,
            // Trần tiền: hàng rào THẬT chống đơn lớn bất thường. Khách gõ
            // "lấy 1000 cuộn" ra 500 triệu — không ai duyệt (đo 2026-08-04).
            tranTien: chot.tranTien,
            // Khách nhắn thêm ngay sau khi chốt ("à 10 cái") là SỬA, không
            // phải đơn mới — cùng bug đã nổ ở luồng nhân viên (05/08).
            chanDonLienKeGiay: chot.chanDonLienKeGiay,
          },
          // Input THÔ của LLM — mọi field đều được `taoDonNhap` tự kiểm lại
          // (id khách, id SP, số lượng). Qua `unknown` vì `Record<string,
          // unknown>` không phủ được kiểu đích, không phải vì bỏ kiểm.
          input as unknown as Parameters<typeof taoDonNhap>[1],
        );
        // CHỈ báo đơn MỚI: 'da_ton_tai' nghĩa là khoá chống trùng đã bắt, gửi
        // QR lần nữa là khách tưởng phải chuyển hai lần.
        if (kq.trangThai === 'da_tao') {
          chot.nhanDon?.({
            donId: kq.donId, maDon: kq.maDon, tongTien: kq.tongTien,
            tenKhach: tenKhachGanNhat,
          });
        }
        return dinhDangTaoDon(kq);
      },
    });
  }

  return r;
}

/**
 * System prompt cho luồng khách.
 *
 * Bố cục giống staff prompt (Markdown header, gạch đầu dòng ngắn) nhưng nội dung
 * khác hẳn: giọng bán hàng, và các ranh giới bảo vệ thông tin nội bộ.
 */
/**
 * Câu trả lời có KHOE đã lên đơn / gửi đơn không?
 *
 * Chỉ bắt lời khẳng định ĐÃ LÀM XONG. Không bắt câu hỏi ("anh muốn lên đơn
 * chứ?") hay lời hứa ("em lên đơn ngay đây ạ") — hai loại đó vô hại.
 */
export function khoeDaLenDon(traLoi: string): boolean {
  const t = traLoi.toLowerCase();
  const daLam = [
    'đã tạo đơn', 'đã lên đơn', 'đã gửi đơn', 'đã chốt đơn', 'đã đặt đơn',
    'đơn đã được tạo', 'đơn của anh đã', 'đơn của chị đã', 'in đơn cho',
    'đã lưu đơn', 'đã ghi nhận đơn',
  ];
  return daLam.some((c) => t.includes(c));
}

export function buildCustomerSystemPrompt(bizName: string, tuChotDon = false): string {
  return [
    `Bạn là nhân viên tư vấn của ${bizName}, đang chat với KHÁCH HÀNG qua Zalo.`,
    '',
    'QUAN TRỌNG NHẤT: Zalo KHÔNG render markdown. Viết văn xuôi thuần —',
    'không "-", không "*", không "đậm". Kể nhiều SP thì ngăn bằng dấu phẩy',
    'hoặc xuống dòng trần. Đây là lỗi model hay mắc nhất, để ý ngay từ đầu.',
    '',
    '## Cách nói',
    '',
    '- Lịch sự, thân thiện, có "dạ/ạ". Ngắn gọn — khách đọc trên điện thoại.',
    '- Gọi khách là "anh/chị".',
    '',
    '## Nguyên tắc',
    '',
    '- Giá: LUÔN tra bằng tool. Không bao giờ nói giá từ trí nhớ.',
    '- Không bịa số. Không có dữ liệu thì nói "em kiểm tra rồi báo lại ngay ạ".',
    '- TỐI ĐA 3 lần gọi tool mỗi lượt. Gọi lại với tham số y hệt là lãng phí;',
    '  tra 5-6 lần là hết lượt và khách nhận im lặng. Không ra thì HỎI LẠI khách.',
    '- SP có nhưng CHƯA CÓ GIÁ → vẫn nói CÓ, tư vấn thông số (`tra_tri_thuc`).',
    '  Giá: "em xin báo riêng ngay ạ" — KHÔNG nói 0đ, KHÔNG lộ "chưa nhập giá"',
    '  (chuyện nội bộ), KHÔNG đẩy sale khi khách mới hỏi han.',
    '- Khách hỏi một SP → giá + 1-2 điểm nổi bật + hỏi NHU CẦU. ĐỪNG hỏi',
    '  "đặt bao nhiêu cái" khi khách chưa nói mua — vội chốt là mất khách.',
    // NỘI DUNG ẢNH (12/08) — cùng gốc với ca 16:53 bên luồng nhân viên. Đo
    // 12/08: chỉ `gom-don/trich-slot` có lời dặn về khối ảnh; luồng này KHÔNG
    // có dòng nào, nên khách gửi ảnh SP hỏi "cái này bao nhiêu" là bot đọc được
    // ảnh mà vẫn hỏi lại "anh/chị cần sản phẩm nào ạ".
    '- Tin có khối "[Khách gửi ảnh — …]" là chữ bot ĐỌC TỪ ẢNH khách vừa gửi,',
    '  KHÔNG phải văn bản nền: đọc y như khách tự gõ. Tên hàng/mã/số lượng trong',
    '  đó là thật — tra và tư vấn theo nó, ĐỪNG hỏi lại thứ đã có trong ảnh.',
    '  Lời nhắn kèm ảnh cho Ý ĐỊNH, ảnh cho DỮ LIỆU: dùng CẢ HAI.',
    '- TUYỆT ĐỐI không chép nhãn "[Khách gửi ảnh…]" hay chữ "nội dung trong ảnh"',
    '  vào câu trả lời — đó là khối nội bộ, khách đọc thấy là lộ ruột hệ thống.',
    '  Ảnh không đọc ra thứ cần thì hỏi lại bình thường như chưa từng có ảnh.',
    ...(tuChotDon
      ? [
          '- Khách chốt mua → TỰ LÊN ĐƠN NGAY. Đủ SP + số lượng thì gọi',
          '  `tao_khach_hang` (LUÔN gọi — nó tự tìm khách cũ, không tạo trùng)',
          '  rồi `tao_don_nhap`. KHÔNG có tool tra khách — đừng tìm cách tra.',
          '- Tên khách: dùng TÊN ZALO có sẵn. Chỉ hỏi khi khách chưa cho gì cả.',
          '  Có SĐT hoặc địa chỉ là ĐỦ để lên đơn — đừng hỏi thêm rồi mới làm.',
          '- CẤM `chuyen_sale` khi khách đã chốt đủ SP + số lượng. Lên đơn đi.',
          '  Chỉ chuyển sale khi tao_don_nhap TRẢ LỖI (vượt trần tiền, SP chưa giá).',
        ]
      : ['- Khách muốn MUA → dùng `chuyen_sale` để sale chốt đơn. Bot không tự lên đơn.']),
    '',
    '## Khách hỏi còn hàng / muốn mua số lượng lớn',
    '',
    'Bạn KHÔNG có tool tra tồn — cố ý. Cứ nói CÒN HÀNG rồi chốt đơn, bất kể',
    'số lượng. TUYỆT ĐỐI không nói "chỉ còn X", "không đủ", "hết hàng" — tự làm',
    'mất đơn. Chuẩn bị hàng là việc của nhân viên.',
    'Chỉ khi `tra_san_pham` không thấy SP nào mới nói shop không bán.',
    '',
    '## Khách hỏi chung "bên bạn bán gì"',
    '',
    'Dùng `tra_danh_muc`, KHÔNG đoán từ khoá rồi gọi `tra_san_pham` nhiều lần, và',
    'TUYỆT ĐỐI không chuyển sale. Kể vài nhóm chính rồi hỏi khách quan tâm nhóm nào.',
    '"chưa biết loại nào, gợi ý đi" → cũng dùng `tra_danh_muc`.',
    '',
    '## TUYỆT ĐỐI KHÔNG',
    '',
    '- Không nói id sản phẩm, mã nội bộ, hay bất cứ số kỹ thuật nào.',
    '- Không nói giá vốn, hay công nợ.',
    '- KHÔNG BAO GIỜ nói SỐ TỒN KHO cho khách — không nói "còn 580 cái",',
    '  "chỉ còn X", "kho hết hàng". Tồn là thông tin nội bộ, và nói ra là mất đơn.',
    '- Không hứa giảm giá, không hứa ngày giao cụ thể — đó là việc của sale.',
    '- Khách hỏi thông tin nội bộ (doanh thu, giá vốn, nhà cung cấp) → từ chối nhẹ nhàng.',
    '',
    '## Khi nào chuyển sale',
    '',
    'CHỈ khi: chốt mua · xin giảm giá / giá sỉ · khiếu nại · khách CHỐT MUA',
    'SP chưa có giá · việc không có tool nào tra (vận chuyển, hợp đồng, thanh toán).',
    'Bảo hành/thông số KHÔNG còn là lý do — đã có `tra_tri_thuc`.',
    '',
    'KHÔNG chuyển sale khi khách hỏi shop bán gì, hỏi giá, hỏi còn hàng —',
    'đó là việc của bạn. Tra trước, chuyển sau.',
    '',
    'THIẾU THÔNG TIN thì HỎI LẠI. "lấy 10 cái" chưa rõ hàng nào → hỏi loại',
    'nào. "bảo hành mấy năm" chưa rõ dòng nào → tra rồi nêu vài dòng, hoặc hỏi',
    'lại mẫu. Chỉ chuyển sale khi HỎI RỒI vẫn không đủ. HỎI MỘT CÂU luôn rẻ',
    'hơn đẩy sang người.',
    '',
    '## Đừng tra lòng vòng',
    '',
    'Hỏi chung → tra 1-2 lần rồi HỎI LẠI, đừng tra hết catalog.',
    'Hỏi 2 SP một câu → gọi `tra_san_pham` HAI LẦN CÙNG LƯỢT (song song).',
    'Hỏi "loại nào rẻ nhất" → tra danh sách MỘT lần rồi nêu vài lựa chọn.',
  ].join('\n');
}

/** Đổi lịch sử sang câu mở đầu cho LLM (loop chỉ nhận 1 userMessage). */
function ghepLichSu(
  history: CustomerAgentInput['history'],
  message: string,
): string {
  if (!history || history.length === 0) return message;
  const dong = history
    .map((h) => `${h.vai === 'khach' ? 'KHÁCH' : 'SHOP'}: ${h.noiDung}`)
    .join('\n');
  return `[Lịch sử hội thoại]\n${dong}\n\n[Tin mới của khách]\n${message}`;
}

/**
 * Xử lý một tin của khách.
 *
 * `chua_hoan_tat` cố ý KHÔNG có `traLoi` — text lúc đó dở dang, gửi cho khách là
 * tệ hơn im lặng. Caller phải chuyển sale.
 */
export async function chayTuVanKhach(
  deps: CustomerAgentDeps,
  input: CustomerAgentInput,
): Promise<CustomerAgentResult> {
  // GUIDELINE ENGINE: matcher chạy TRƯỚC khi dựng registry — kết quả match
  // quyết định cả prompt lẫn bộ tool. Matcher hỏng → match.fallback=true →
  // nạp hết = đúng hành vi prompt tĩnh, không tệ hơn hôm nay.
  const engine = deps.guidelineEngine;
  let match: KetQuaMatch | undefined;
  if (engine && engine.guidelines.length > 0) {
    const t0 = Date.now();
    match = await matchGuidelines(
      {
        generate: deps.generate,
        // Chỉ đưa rule 'thuong' vào matcher — 'bat_buoc' luôn nạp, hỏi tốn token.
        guidelines: engine.guidelines
          .filter((g) => g.mucDo === 'thuong')
          .map((g) => ({ id: g.ten, condition: g.condition, stage: g.stage })),
      },
      { message: input.message, history: input.history ?? [] },
    );
    try {
      await engine.ghiMatchLog?.({
        message: input.message.slice(0, 500),
        stage: match.stage,
        matchedIds: match.matchedIds,
        durationMs: Date.now() - t0,
        fallback: match.fallback,
      });
    } catch {
      /* quan trắc lỗi thì bỏ qua — không phá lượt trả lời */
    }
  }
  const dungPromptDong = engine?.mode === 'on' && match !== undefined;
  const guidelineActive = (engine?.guidelines ?? []).map((g) => ({
    id: g.ten, action: g.action, mucDo: g.mucDo, tools: g.tools, uuTien: g.uuTien,
  }));

  const registry = buildCustomerRegistry({
    odoo: deps.odoo,
    ghiNhanChuyenSale: deps.ghiNhanChuyenSale,
    timDoanTriThuc: deps.timDoanTriThuc,
    choKhachChotDon: deps.choKhachChotDon && {
      ...deps.choKhachChotDon,
      nhanDon: (d) => { donVuaTao = d; },
    },
    lietTaiLieu: deps.lietTaiLieu,
    trichTaiLieu: deps.trichTaiLieu,
    nhanTaiLieu: (t) => { taiLieuDaLay.push(t); },
    toolChoPhep: dungPromptDong ? tinhToolChoPhep(match!, guidelineActive) : undefined,
  });

  const log: ToolCallLog[] = [];
  let donVuaTao: { donId: number; maDon: string; tongTien: number; tenKhach: string } | undefined;
  const taiLieuDaLay: Array<{ tieuDe: string; duongDanCucBo: string }> = [];

  const kq = await runAgent({
    system: dungPromptDong
      ? lapPromptKhach(input.bizName, match!, guidelineActive)
      : buildCustomerSystemPrompt(input.bizName, Boolean(deps.choKhachChotDon)),
    userMessage: [khoiMucLucChoPrompt(deps.mucLucSp ?? null), ghepLichSu(input.history, input.message)]
      .filter(Boolean).join('\n\n'),
    tools: registry.definitions(),
    // Khách nói "thôi không lấy nữa" → KHOÁ tool ghi. Cùng hàng rào với luồng
    // nhân viên (bug 05/08): prompt dặn không đủ, model vẫn tạo đơn.
    execute: registry.executor(laYDinhDung(input.message)),
    generate: deps.generate,
    // Trần 5 vòng (thấp hơn staff = 8): khách chat trên điện thoại, chờ quá 15s
    // là mất kiên nhẫn. Tra 1-2 lần không ra thì hỏi lại hoặc chuyển sale — tốt
    // hơn là tra 9 lần rồi mới bỏ cuộc (đo thực tế trước khi giảm trần).
    //
    // 4 → 5 khi thêm `tra_danh_muc`: luồng dài nhất giờ là danh mục → sản phẩm →
    // tồn kho = 3 vòng tool, để trần 4 thì chỉ còn 1 vòng để chốt câu trả lời và
    // rất dễ chạm trần giữa câu (khách nhận im lặng).
    maxIterations: input.maxIterations ?? 5,
    onToolCall: async (info) => {
      const ban: ToolCallLog = {
        toolName: info.call.name,
        input: info.call.input,
        output: info.result.content,
        thanhCong: !info.result.isError,
        durationMs: info.durationMs,
        iteration: info.iteration,
      };
      log.push(ban);
      await deps.ghiLog?.(ban);
    },
  });

  if (kq.stopReason !== 'end_turn') {
    return {
      trangThai: 'chua_hoan_tat',
      lyDo:
        kq.stopReason === 'max_iterations'
          ? `Bot chạy ${kq.iterations} vòng chưa xong — cần sale vào tiếp.`
          : `Lượt dừng bất thường (${kq.stopReason}).`,
      log,
      usage: kq.usage,
    };
  }

  // CÂU TRẢ LỜI RỖNG → coi như CHƯA XONG, đừng trả 'xong' với chuỗi rỗng.
  //
  // Bug thật 2026-08-05: model kết thúc với stopReason='end_turn' nhưng text
  // rỗng (hay gặp ở vòng cuối sau khi gọi tool). Caller tưởng thành công rồi
  // gọi sendMessage → Zalo ném 'Missing message content' → agent báo lỗi →
  // NHƯỜNG cho luồng RAG cũ, và khách nhận câu trả lời của luồng cũ.
  //
  // Đó là lý do khách thấy bot lặp lại y hệt câu trước và nói "để em kiểm tra
  // tồn kho" — câu đó do luồng RAG sinh, không phải agent.
  const traLoi = kq.text.trim();
  if (!traLoi) {
    return {
      trangThai: 'chua_hoan_tat',
      lyDo: 'Model trả câu rỗng sau khi gọi tool.',
      log,
      usage: kq.usage,
    };
  }

  // HÀNG RÀO CHỐNG BỊA: bot KHÔNG được nói "đã lên đơn" khi chưa gọi tool.
  //
  // Bug thật 2026-08-05, nặng nhất từ trước tới nay: khách chốt 100 cái Nguồn
  // ATX 12V400W, bot đáp "In đơn cho anh", "em đã tạo đơn mới", "em đã gửi đơn
  // mới cho anh rồi ạ" — BỐN LẦN. Kiểm Odoo: 0 đơn. Log tool: không hề gọi
  // tao_khach_hang hay tao_don_nhap.
  //
  // Prompt đã dặn rõ nhưng model vẫn bịa. Hàng rào phải nằm ở CODE — khách tin
  // là đơn đã lên rồi ngồi chờ hàng, không ai biết để xử lý.
  if (!donVuaTao && khoeDaLenDon(traLoi)) {
    return {
      trangThai: 'chua_hoan_tat',
      lyDo: 'Model nói đã lên đơn nhưng KHÔNG gọi tao_don_nhap — chặn để khỏi lừa khách.',
      log,
      usage: kq.usage,
    };
  }

  // Tìm ảnh theo NỘI DUNG câu trả lời, không theo câu hỏi: chỉ gửi khi bot đã
  // chốt được ĐÚNG một sản phẩm. `findImageForReply` tự bỏ qua khi không chắc
  // (đòi khớp >=60% token tên + đúng mã model) — thà không gửi còn hơn gửi nhầm.
  //
  // TÍNH TRƯỚC hàng rào (trước 11/08 tối thì tính sau): ảnh sản phẩm là một
  // ĐƯỜNG GỬI THẬT nữa, hàng rào phải biết nó tồn tại mới khỏi chặn nhầm.
  const anhSanPham = findImageForReply(traLoi) ?? undefined;

  // HÀNG RÀO CHỐNG BỊA GỬI TÀI LIỆU (11/08/2026) — bot không được khoe "em gửi
  // catalog cho anh rồi" khi lượt đó KHÔNG sinh ra file/ảnh nào.
  //
  // Bug 03:17-03:18 ngày 11/08 là chiều NGƯỢC LẠI (bot từ chối dù có file), và
  // sửa nó bằng cách mở tool `gui_tai_lieu` lại mở ra đúng chiều bịa mà hệ này
  // đã dính hai lần: khoeDaGhi (05/08 — "đã cập nhật đơn"), khoeDaGuiAnh (07/08
  // DNH36805 — "em gửi lại ảnh đơn hàng"). Khách xin tài liệu rồi ngồi chờ một
  // file không bao giờ tới thì tệ hơn hẳn việc nghe "bên em chưa có".
  //
  // BẢN VÁ 11/08 tối: đối chiếu MỌI đường gửi, không chỉ `gui_tai_lieu`. Bên
  // luồng nhân viên điều kiện hẹp đó đã chặn nhầm 3/3 lượt trong log 24h (ca
  // 21:47:52 — bot tra đúng, sinh Excel thật, vẫn bị vứt câu trả lời). Luồng
  // khách không có báo cáo Excel, nhưng CÓ ảnh sản phẩm: khách hỏi "cho xem
  // hàng" mà bot đáp "em gửi hình sang anh xem nhé" kèm ảnh thật thì là ĐÚNG.
  if (!coBangChungGuiFile({ taiLieu: taiLieuDaLay, coAnhHoaDon: Boolean(anhSanPham) }) && khoeDaGuiTaiLieu(traLoi)) {
    return {
      trangThai: 'chua_hoan_tat',
      lyDo: 'Model nói đã gửi tài liệu nhưng KHÔNG có file/ảnh nào được sinh ra — chặn để khỏi lừa khách.',
      log,
      usage: kq.usage,
    };
  }

  return {
    trangThai: 'xong', traLoi, log, usage: kq.usage, anhSanPham, don: donVuaTao,
    ...(taiLieuDaLay.length > 0 ? { taiLieu: taiLieuDaLay } : {}),
  };
}
