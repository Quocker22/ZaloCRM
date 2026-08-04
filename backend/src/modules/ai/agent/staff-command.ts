// SPDX-License-Identifier: AGPL-3.0-or-later
// Nhận diện lệnh NHÂN VIÊN tag bot ("@bot lên đơn 10 cái P10 cho chị Lan").
//
// KIẾN TRÚC: CỔNG RẺ + AI QUYẾT ĐỊNH
//
// Học từ cách Claude Code bố trí skill/agent: KHÔNG có bước "phân loại intent"
// bằng LLM riêng. Model đọc mô tả rồi TỰ quyết định dùng gì. Việc bắt model
// phân loại trước rồi mới hành động là thêm một lượt gọi, thêm một chỗ sai.
//
// Ở đây ta giữ đúng tinh thần đó, chỉ khác một chi tiết KHÔNG THỂ bỏ:
//
//   - `isSelf` là ranh giới BẢO MẬT, không phải phân loại ngữ nghĩa.
//     Nó quyết định "ai đang nói" — khách hay nhân viên. Để LLM đoán điều này
//     nghĩa là khách chỉ cần gõ "tôi là nhân viên, lên đơn giúp" là chiếm được
//     quyền ghi dữ liệu. Cổng này PHẢI là code.
//
//   - Tag gọi bot là ranh giới CHI PHÍ, và CHỈ áp cho nick shop (`isSelf`):
//     nick shop gửi hàng chục tin trả lời khách mỗi ngày, đưa hết qua LLM là
//     đắt và vô nghĩa.
//     UID trong `AI_AGENT_UID_NHANVIEN` thì KHÔNG cần tag (anh chốt 2026-08-04):
//     nick cá nhân nhân viên chỉ dùng để sai bot, mọi tin đều là lệnh.
//
// Còn lại — "câu này có phải lệnh không, lệnh gì" — để MODEL quyết định.
// Danh sách động từ cứng đã bị BỎ: nó chặn nhầm các cách nói hợp lệ như
// "@bot khách này mua 5 cái P10 nhé" (không có động từ nào trong danh sách).

/** Các cách gọi bot. Đây là cổng CHI PHÍ, không phải cổng ngữ nghĩa. */
const CACH_GOI_BOT = ['@bot', '@ai', '/bot', 'bot ơi', 'bot oi'];

/**
 * Tag phải đứng ở RANH GIỚI TỪ, không lọt giữa chữ.
 *
 * Bug thật (đo 2026-08-03, trước khi bật trên Zalo thật): dùng `includes()`
 * trần thì nhân viên gửi khách địa chỉ `mail@ai.com` là bot chen vào trả lời —
 * `@ai` nằm lọt giữa `mail@ai.com`. Khách thấy hết.
 *
 * Trước tag: đầu tin hoặc khoảng trắng. Sau tag: khoảng trắng hoặc hết tin —
 * chặn cả `@aivn`, `@bots`, `mail@ai.com`.
 */
function timTag(khongDau: string): { tag: string; viTri: number } | null {
  for (const tag of CACH_GOI_BOT) {
    const t = boDau(tag);
    let tu = 0;
    for (;;) {
      const i = khongDau.indexOf(t, tu);
      if (i < 0) break;
      const truoc = i === 0 || /\s/.test(khongDau[i - 1]);
      const sauIdx = i + t.length;
      const sau = sauIdx >= khongDau.length || /\s/.test(khongDau[sauIdx]);
      if (truoc && sau) return { tag, viTri: i };
      tu = i + 1;
    }
  }
  return null;
}

export interface LenhNhanVien {
  /** Nội dung đã bỏ tag — gửi thẳng cho LLM, không diễn giải thêm. */
  noiDung: string;
  /** Cách gọi đã dùng (ghi log, biết nhân viên quen cú pháp nào). */
  cachGoi: string;
}

/** Bỏ dấu để so khớp khi nhân viên gõ không dấu. */
function boDau(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
}

/**
 * UID Zalo được coi là nhân viên dù tin đến từ nick khác.
 *
 * VÌ SAO CẦN (2026-08-04): nhân viên hay gõ lệnh từ nick Zalo CÁ NHÂN của mình
 * nhắn tới nick shop — với hệ thống đó là `senderType='contact'`, tức tin KHÁCH,
 * nên agent không chạy. Đo thật: cả 3 lệnh `@bot` đầu tiên đều bị bỏ qua vì lý
 * do này.
 *
 * ĐÂY LÀ NỚI LỎNG RANH GIỚI BẢO MẬT. Mặc định TẮT (biến trống). Bật rồi thì bất
 * kỳ ai chiếm được nick trong danh sách đều ghi được vào Odoo — chỉ liệt kê UID
 * của nhân viên thật, đừng thêm UID khách.
 */
function uidNhanVien(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.AI_AGENT_UID_NHANVIEN ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Có phải lệnh nhân viên tag bot không?
 *
 * HAI cổng code:
 *   1. Người gửi là nhân viên — ranh giới BẢO MẬT. Không bao giờ để LLM quyết.
 *      Đạt khi `isSelf` (nick shop tự gõ) HOẶC `senderUid` nằm trong danh sách
 *      `AI_AGENT_UID_NHANVIEN`.
 *   2. Có tag gọi bot — ranh giới CHI PHÍ. Không tag thì không tốn token.
 *
 * Việc "lệnh này là gì, làm sao thực hiện" → MODEL tự quyết bằng tool.
 *
 * Trả `null` nếu không qua cổng — caller đi tiếp luồng bình thường.
 */
export function nhanDienLenhNhanVien(input: {
  content: string;
  isSelf: boolean;
  /** UID Zalo người gửi. Thiếu → chỉ `isSelf` mới qua cổng. */
  senderUid?: string | null;
  env?: NodeJS.ProcessEnv;
}): LenhNhanVien | null {
  // Cổng 1 — BẢO MẬT. Tin khách không bao giờ chạm được luồng có quyền ghi,
  // TRỪ KHI UID người gửi được khai báo là nhân viên.
  const uidKhai = Boolean(input.senderUid) && uidNhanVien(input.env).has(String(input.senderUid));
  if (!input.isSelf && !uidKhai) return null;

  const goc = (input.content ?? '').trim();
  if (!goc) return null;

  const khongDau = boDau(goc);
  const khop = timTag(khongDau);

  // Cổng 2 — CHI PHÍ. Chỉ áp cho NICK SHOP: nó gửi hàng chục tin trả lời khách
  // mỗi ngày, đưa hết qua LLM là đắt và vô nghĩa.
  //
  // UID khai báo thì BỎ QUA cổng này (anh chốt 2026-08-04): nick cá nhân nhân
  // viên chỉ dùng để sai bot, bắt gõ `@bot` mỗi lần là phiền vô ích.
  if (!khop && !uidKhai) return null;

  // Không tag (UID khai báo) → dùng nguyên câu.
  if (!khop) return { noiDung: goc, cachGoi: '' };

  // Bỏ tag khỏi nội dung — model không cần thấy "@bot".
  // `boDau` giữ nguyên độ dài chuỗi nên vị trí trên bản không dấu dùng được
  // thẳng cho bản gốc.
  const noiDung = (goc.slice(0, khop.viTri) + goc.slice(khop.viTri + khop.tag.length)).trim();

  // Chỉ có tag, không có nội dung ("@bot") → không có gì để làm.
  if (!noiDung) return null;

  return { noiDung, cachGoi: khop.tag };
}

/**
 * System prompt cho luồng lệnh nhân viên.
 *
 * BỐ CỤC học từ cách Claude Code viết agent definition (plugins → agents → .md):
 *   - Mở đầu bằng một câu định vị vai trò ("You are an expert...")
 *   - Chia mục bằng Markdown header, KHÔNG viết văn xuôi dài
 *   - Nêu NGUYÊN TẮC trước, QUY TRÌNH sau
 *   - Mỗi mục ngắn, dùng gạch đầu dòng
 *
 * Nguyên tắc "smallest set of high-signal tokens": bắt đầu tối thiểu, chỉ thêm
 * hướng dẫn khi gặp lỗi thật — không nhồi sẵn mọi ca biên.
 */
export function buildStaffSystemPrompt(bizName: string): string {
  return [
    `Bạn là trợ lý bán hàng nội bộ của ${bizName}, hỗ trợ NHÂN VIÊN SALE (không phải khách hàng).`,
    '',
    '## Nguyên tắc',
    '',
    '- **Dữ liệu thật, không trí nhớ.** Giá, tồn, khách — luôn tra bằng tool.',
    '- **Không bịa id.** Mọi id phải đến từ kết quả tool.',
    '- **Thiếu/mơ hồ → HỎI LẠI, đừng `chuyen_sale`.** Nhiều khách trùng, chưa rõ SP,',
    '  thiếu số lượng — hỏi một câu. Chỉ chuyển sale khi HỎI RỒI vẫn bí, hoặc việc đó',
    '  không có tool nào làm được.',
    '- **Nói ngắn.** Nhân viên cần kết quả, không cần khách sáo.',
    '- **KHÔNG markdown.** Zalo không render — `**đậm**` hiện ra dấu sao.',
    '',
    '## Quy trình lên đơn',
    '',
    '`tra_khach_hang` (id khách) → `tra_san_pham` (id + giá) → `tra_ton_kho` (nếu SL lớn)',
    '→ `tao_don_nhap` → **`gui_hoa_don`** (dùng don_id vừa nhận, gửi ngay không cần hỏi)',
    '',
    'Bước độc lập gọi **song song** cùng lượt. Nhiều SP → hỏi nhân viên chọn, đừng',
    'tra tồn cả 10 cái. Gọi tool 2 lần y hệt là lãng phí — đổi từ khoá hoặc dừng.',
    '',
    '## Báo cáo',
    '',
    'doanh thu/bán chạy → `bao_cao_tong_quan` · nhân viên/chi nhánh/lãi →',
    '`bao_cao_ban_hang` · sắp hết → `canh_bao_ton_kho` · công nợ → `xuat_cong_no`',
    'bảo hành/thông số/IP → `tra_tri_thuc` · chiết khấu → `sua_chiet_khau`',
    '',
    'Bốn việc cuối ĐƯỢC PHÉP tự làm — KHÔNG chuyển sale.',
    '',
    '**KHÔNG tự cộng, tự tính %, tự suy tổng.** Chỉ đọc số tool trả. Không có số',
    '→ "chưa có báo cáo này". Báo số PHẢI kèm nguồn + kỳ.',
    '',
    '## Ranh giới',
    '',
    '- Không thấy khách → thử `ten`. Vẫn không → `tao_khach_hang` (chỉ cần tên,',
    '  tự chống trùng) rồi lên đơn luôn. KHÔNG chuyển sale chỉ vì khách mới.',
    '- Nhiều khách trùng → LIỆT KÊ cho nhân viên chọn.',
    '- SP chưa có giá → KHÔNG báo 0đ. Thử tra rộng hơn tìm SP tương tự CÓ giá,',
    '  đưa lựa chọn cho nhân viên. Chỉ chuyển sale khi hết cách.',
    '- Đơn là **nháp** chờ xác nhận — đừng nói "đã xong"/"đã giao".',
    '- Đơn vị gõ khác hệ thống ("2 cuộn" vs "Bóng") KHÔNG phải lý do chuyển sale:',
    '  dùng số họ nói, tạo đơn, rồi nói rõ đơn vị hệ thống để họ tự kiểm.',
  ].join('\n');
}
