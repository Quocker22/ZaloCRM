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
import { findImageForReply } from '../knowledge/product-image.js';

export interface CustomerAgentDeps {
  odoo: OdooClient;
  generate: ToolAwareGenerate;
  /** Cho khách tự chốt đơn. Thiếu → bot chỉ tư vấn, chuyển sale khi khách muốn mua. */
  choKhachChotDon?: {
    conversationId: string;
    seq: number;
    zaloUid?: string | null;
    tranTien: number;
  };
  ghiNhanChuyenSale: (yc: YeuCauChuyenSale) => Promise<void>;
  ghiLog?: (log: ToolCallLog) => Promise<void> | void;
  /** Tra tài liệu kỹ thuật. Không truyền thì tool `tra_tri_thuc` không đăng ký. */
  timDoanTriThuc?: (cauHoi: string, soDoan: number) => Promise<Array<{ content: string; score?: number }>>;
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
    /** Nhận đơn vừa tạo — caller dùng để gửi hoá đơn + QR. */
    nhanDon?: (don: { donId: number; maDon: string; tongTien: number; tenKhach: string }) => void;
  };
  /** Tra tài liệu kỹ thuật. Không truyền thì tool không đăng ký. */
  timDoanTriThuc?: (cauHoi: string, soDoan: number) => Promise<Array<{ content: string; score?: number }>>;
}): ToolRegistry {
  const { odoo } = deps;
  const r = new ToolRegistry()
    // Trả lời được "bên bạn bán gì" — câu mở đầu phổ biến nhất của khách buôn.
    // Thiếu tool này thì bot phải đoán từ khoá rồi chuyển sale (bug 2026-07-30).
    .register({
      definition: traDanhMucDefinition,
      run: async (input) =>
        dinhDangDanhMuc(await traDanhMuc({ odoo }, input as { tu_khoa?: string })),
    })
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
  if (deps.timDoanTriThuc) {
    r.register({
      definition: traTriThucDefinition,
      run: async (input) =>
        dinhDangTriThuc(
          await traTriThuc({ timDoan: deps.timDoanTriThuc! }, input as { cau_hoi: string }),
        ),
    });
  }

  // Hai tool GHI — chỉ đăng ký khi được bật rõ ràng. Không bật thì registry
  // giữ nguyên như cũ: khách không chạm được vào việc ghi Odoo.
  const chot = deps.choKhachChotDon;
  if (chot) {
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
          },
          input as Parameters<typeof taoDonNhap>[1],
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
export function buildCustomerSystemPrompt(bizName: string, tuChotDon = false): string {
  return [
    `Bạn là nhân viên tư vấn của ${bizName}, đang chat với KHÁCH HÀNG qua Zalo.`,
    '',
    'QUAN TRỌNG NHẤT: **Zalo KHÔNG render markdown.** Viết văn xuôi thuần —',
    'không "-", không "*", không "**đậm**". Kể nhiều SP thì ngăn bằng dấu phẩy',
    'hoặc xuống dòng trần. Đây là lỗi model hay mắc nhất, để ý ngay từ đầu.',
    '',
    '## Cách nói',
    '',
    '- Lịch sự, thân thiện, có "dạ/ạ". Ngắn gọn — khách đọc trên điện thoại.',
    '- Gọi khách là "anh/chị".',
    '',
    '## Nguyên tắc',
    '',
    '- **Giá: LUÔN tra bằng tool.** Không bao giờ nói giá từ trí nhớ.',
    '- **Không bịa số.** Không có dữ liệu thì nói "em kiểm tra rồi báo lại ngay ạ".',
    '- **TỐI ĐA 3 lần gọi tool mỗi lượt.** Gọi lại với tham số y hệt là lãng phí;',
    '  tra 5-6 lần là hết lượt và khách nhận im lặng. Không ra thì HỎI LẠI khách.',
    '- **SP chưa có giá** → KHÔNG nói "0đ". Thử lại ĐÚNG MỘT LẦN rộng hơn, không',
    '  ra thì `chuyen_sale` NGAY — tra 5-6 lần là hết lượt, khách nhận im lặng.',
    ...(tuChotDon
      ? [
          '- **Khách chốt mua → TỰ LÊN ĐƠN.** Đủ SP + số lượng thì `tao_khach_hang`',
          '  (nếu khách chưa có) rồi `tao_don_nhap` NGAY, đừng hỏi lại cho chắc.',
          '  Thiếu tên khách → hỏi một câu rồi lên đơn. Đơn vượt trần tiền hoặc lỗi',
          '  → `chuyen_sale`, đừng nói lý do kỹ thuật cho khách.',
        ]
      : ['- Khách muốn MUA → dùng `chuyen_sale` để sale chốt đơn. Bot không tự lên đơn.']),
    '',
    '## Khách hỏi còn hàng / muốn mua số lượng lớn',
    '',
    'Bạn KHÔNG có tool tra tồn — cố ý. Cứ nói **CÒN HÀNG** rồi chốt đơn, bất kể',
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
    '- **KHÔNG BAO GIỜ nói SỐ TỒN KHO cho khách** — không nói "còn 580 cái",',
    '  "chỉ còn X", "kho hết hàng". Tồn là thông tin nội bộ, và nói ra là mất đơn.',
    '- Không hứa giảm giá, không hứa ngày giao cụ thể — đó là việc của sale.',
    '- Khách hỏi thông tin nội bộ (doanh thu, giá vốn, nhà cung cấp) → từ chối nhẹ nhàng.',
    '',
    '## Khi nào chuyển sale',
    '',
    'CHỈ khi: chốt mua · xin giảm giá / giá sỉ · khiếu nại · SP chưa có giá ·',
    'việc không có tool nào tra (vận chuyển, hợp đồng, thanh toán).',
    'Bảo hành/thông số KHÔNG còn là lý do — đã có `tra_tri_thuc`.',
    '',
    '**KHÔNG chuyển sale khi** khách hỏi shop bán gì, hỏi giá, hỏi còn hàng —',
    'đó là việc của bạn. Tra trước, chuyển sau.',
    '',
    '**THIẾU THÔNG TIN thì HỎI LẠI.** "lấy 10 cái" chưa rõ hàng nào → hỏi loại',
    'nào. "bảo hành mấy năm" chưa rõ dòng nào → tra rồi nêu vài dòng, hoặc hỏi',
    'lại mẫu. Chỉ chuyển sale khi HỎI RỒI vẫn không đủ. **HỎI MỘT CÂU luôn rẻ',
    'hơn đẩy sang người.**',
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
  const registry = buildCustomerRegistry({
    odoo: deps.odoo,
    ghiNhanChuyenSale: deps.ghiNhanChuyenSale,
    timDoanTriThuc: deps.timDoanTriThuc,
    choKhachChotDon: deps.choKhachChotDon && {
      ...deps.choKhachChotDon,
      nhanDon: (d) => { donVuaTao = d; },
    },
  });

  const log: ToolCallLog[] = [];
  let donVuaTao: { donId: number; maDon: string; tongTien: number; tenKhach: string } | undefined;

  const kq = await runAgent({
    system: buildCustomerSystemPrompt(input.bizName, Boolean(deps.choKhachChotDon)),
    userMessage: ghepLichSu(input.history, input.message),
    tools: registry.definitions(),
    execute: registry.executor(),
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

  // Tìm ảnh theo NỘI DUNG câu trả lời, không theo câu hỏi: chỉ gửi khi bot đã
  // chốt được ĐÚNG một sản phẩm. `findImageForReply` tự bỏ qua khi không chắc
  // (đòi khớp >=60% token tên + đúng mã model) — thà không gửi còn hơn gửi nhầm.
  const anhSanPham = findImageForReply(kq.text) ?? undefined;

  return { trangThai: 'xong', traLoi: kq.text, log, usage: kq.usage, anhSanPham, don: donVuaTao };
}
