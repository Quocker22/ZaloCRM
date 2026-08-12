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

import { dongNgayHomNay } from '../odoo/ky-thoi-gian.js';

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

/**
 * Text có chứa tag gọi bot không (@bot, @ai, bot ơi…) — cho gate NHÓM của
 * luồng khách: khách trong nhóm gõ tay "@bot còn hàng không" cũng phải được
 * trả lời, dù họ không mention Zalo thật.
 */
export function coTagBot(content: string): boolean {
  return timTag(boDau(String(content ?? '').trim())) !== null;
}

export interface LenhNhanVien {
  /** Nội dung đã bỏ tag — gửi thẳng cho LLM, không diễn giải thêm. */
  noiDung: string;
  /** Cách gọi đã dùng (ghi log, biết nhân viên quen cú pháp nào). */
  cachGoi: string;
  /**
   * Tag nhưng KHÔNG kèm nội dung ("@bot" trống).
   *
   * Vẫn là lệnh — tag là gọi bot, im lặng làm người gọi tưởng bot chết (bug
   * 21:05:00 10/08). Nhưng caller ĐỪNG gọi LLM: không có gì để suy nghĩ, và
   * một dấu tag không đáng ~3k token. Đáp một câu tất định là đủ.
   */
  tagTrong?: true;
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
  /**
   * BẮT BUỘC có tag dù UID đã khai — dùng cho tin trong NHÓM (06/08/2026).
   *
   * Đặc quyền không-cần-tag sinh ra cho chat 1-1 với nick shop: ở đó mọi tin
   * của nhân viên đều là lệnh. Trong NHÓM thì ngược lại — nhân viên tán gẫu,
   * bàn việc, nói với khách; coi mọi câu là lệnh thì bot chen vào liên tục
   * và đốt tiền LLM theo từng câu chuyện phiếm.
   */
  batBuocTag?: boolean;
  /**
   * Bot ĐANG HỎI chính người gửi này và chờ họ trả lời — nới `batBuocTag`.
   *
   * Bug thật 17:07-17:08 10/08 (nhóm): nhân viên tag bot "lên đơn cho anh
   * chiến", bot liệt kê 10 anh Chiến rồi hỏi chọn. Nhân viên trả lời "khách
   * mới" — không tag — nên `batBuocTag` vứt câu đó. Bot không bao giờ thấy câu
   * trả lời của chính câu nó vừa hỏi; phiên treo, nhân viên tưởng bot hỏng.
   *
   * Caller CHỈ được đặt `true` khi có phiên gom đơn còn hạn VÀ `phien.hoiUid`
   * khớp UID người gửi. Không nới cho người khác trong nhóm: bot sẽ bốc câu
   * tán gẫu của người ngoài làm câu chọn. Cổng 1 (bảo mật) vẫn áp nguyên —
   * người lạ không thành nhân viên chỉ vì bot đang hỏi ai đó.
   */
  dangChoTraLoi?: boolean;
  /**
   * Hàm kiểm "UID này có phải nhân viên không" — do caller bind sẵn orgId
   * (agent-operator-service.laNhanVienSync). Không truyền → chỉ dùng env, để
   * test cũ và luồng không có orgId vẫn chạy. Thay cho `env` đọc trực tiếp:
   * bảng nhân viên giờ ở DB (06/08/2026), env chỉ còn là lớp tương thích ngược.
   */
  laNhanVien?: (uid: string) => boolean;
  env?: NodeJS.ProcessEnv;
}): LenhNhanVien | null {
  // Cổng 1 — BẢO MẬT. Tin khách không bao giờ chạm được luồng có quyền ghi,
  // TRỪ KHI UID người gửi được khai báo là nhân viên (DB qua laNhanVien, hoặc
  // env qua uidNhanVien — hợp nhất, giữ tương thích ngược).
  const uid = input.senderUid ? String(input.senderUid) : '';
  const uidKhai = Boolean(uid) &&
    ((input.laNhanVien?.(uid) ?? false) || uidNhanVien(input.env).has(uid));
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
  // NGOẠI LỆ: trong nhóm (`batBuocTag`) thì UID cũng phải tag — xem chú thích trên.
  // NGOẠI LỆ CỦA NGOẠI LỆ: bot vừa hỏi CHÍNH người này và đang chờ trả lời
  // (`dangChoTraLoi`) — câu kế của họ là câu trả lời, bắt tag lại là vô lý và
  // làm treo phiên (bug 17:08 10/08).
  const batTag = input.batBuocTag === true && input.dangChoTraLoi !== true;
  if (!khop && (!uidKhai || batTag)) return null;

  // Không tag (UID khai báo) → dùng nguyên câu.
  if (!khop) return { noiDung: goc, cachGoi: '' };

  // Bỏ tag khỏi nội dung — model không cần thấy "@bot".
  // `boDau` giữ nguyên độ dài chuỗi nên vị trí trên bản không dấu dùng được
  // thẳng cho bản gốc.
  // Cắt tag ở GIỮA chuỗi (vd sau tiền tố quote) để lại hai khoảng trắng liền
  // nhau — gộp lại một, model không cần thấy vết mổ.
  const noiDung = (goc.slice(0, khop.viTri) + goc.slice(khop.viTri + khop.tag.length))
    .replace(/[^\S\n]{2,}/g, ' ')
    .trim();

  // Chỉ có tag, không có nội dung ("@bot") → VẪN nhận việc.
  //
  // Trước đây trả null (im lặng). Anh Quốc 10/08: "khi tag là chắc chắn khách
  // cần xử lý rồi thì vẫn phải handle chứ????" — đúng, người ta tag là đang
  // gọi; im lặng là phản hồi tệ nhất vì không phân biệt được với bot chết.
  // Caller nhìn `tagTrong` để đáp câu tất định, không tốn lượt LLM.
  if (!noiDung) return { noiDung: '', cachGoi: khop.tag, tagTrong: true };

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
export function buildStaffSystemPrompt(bizName: string, bayGio: Date = new Date()): string {
  // KHÔNG một dấu `**` nào trong prompt này: prompt cấm markdown mà tự chứa
  // markdown là bot bắt chước (quy tắc 7, đã trả giá ở prompt khách 05/08).
  return [
    `Bạn là trợ lý bán hàng nội bộ của ${bizName}, hỗ trợ NHÂN VIÊN SALE (không phải khách hàng).`,
    // ═══ NGÀY HÔM NAY ─ thiếu dòng này là model đoán mò ═══════════════════
    // HAI CA THẬT CÙNG NGÀY 11/08/2026:
    //   21:17 (nhóm Test-AI) — NV: "báo cáo theo ngày các sản phẩm bán ra hôm
    //   nay". Bot: "bán ra + tồn kho hôm nay (20/06/2026)". Anh Quốc: "sao lại
    //   20/6/2026 ???" — lệch gần 2 tháng, cả báo cáo sai kỳ mà trình bày y
    //   như thật, kèm 7 mã "bất thường" để kho đi đếm vô ích.
    //   03:29 CÙNG NGÀY — bot tự thú: "không rõ hôm nay là ngày nào", cũng
    //   đúng con số 2026-06-20. Model không đoán ngẫu nhiên mà rơi về CÙNG một
    //   mốc bịa.
    // Trước vá, grep "hôm nay|ngày hiện tại|toISOString" trong file này ra 0
    // kết quả — model không có cách nào biết ngày.
    //
    // CHỈ NGÀY, KHÔNG GIỜ/PHÚT — quyết định về CHI PHÍ: prompt cache theo nội
    // dung, thêm giờ vào là mỗi lượt một prefix khác → cache miss 100%, đắt
    // gấp ~4 lần. Chỉ ngày thì prefix đổi đúng 1 lần/24h. Xem ky-thoi-gian.ts.
    dongNgayHomNay(bayGio),
    '',
    '## Nguyên tắc',
    '',
    '- Dữ liệu thật, không trí nhớ. Giá, tồn, khách — luôn tra bằng tool.',
    '- Không bịa id. Mọi id phải đến từ kết quả tool.',
    '- Thiếu/mơ hồ (nhiều khách trùng, chưa rõ SP, thiếu SL) → HỎI LẠI một câu.',
    '- Vừa nói rõ, hoặc đáp "đúng/ok/ừ/làm đi" → ghi NGAY, KHÔNG hỏi lại.',
    '- Nhân viên gõ mã KH (dạng KH001017) → tra khách bằng `ma`.',
    '- Nói ngắn, gọi "anh/chị", không đoán giới tính. KHÔNG markdown.',
    '- Chào hỏi/đùa/câu cá nhân → đáp NGẮN, KHÔNG gọi tool. Tin có từ thô/chửi',
    '  → đừng lấy chữ đó làm tên khách/SP đi tra; hiểu ý theo ngữ cảnh.',
    '- Không lặp nhãn khung ([Hội thoại trước], [Tin mới]…) trong câu trả lời.',
    // NỘI DUNG ẢNH (12/08) — ca thật 16:53: nhân viên gửi ảnh danh sách hàng kèm
    // lệnh, bot dùng lệnh nhưng BỎ QUA ảnh rồi hỏi lại đúng thứ đã có trong ảnh.
    // Đo 12/08: lời dặn về khối ảnh CHỈ có ở `gom-don/trich-slot`; prompt này và
    // luồng khách KHÔNG có dòng nào — ảnh + "tra tồn kho mấy cái này" hay ảnh +
    // "công nợ khách này" rơi vào vùng trống. Chưa ai báo lỗi vì chưa ai thử.
    '- Khối "[Khách gửi ảnh…]" = chữ ĐỌC TỪ ẢNH, coi như họ tự gõ: hàng/mã/SL/',
    '  tiền trong đó là THẬT, dùng ngay, ĐỪNG hỏi lại thứ ảnh đã có. Lời nhắn',
    '  cho Ý ĐỊNH, ảnh cho DỮ LIỆU — dùng CẢ HAI. Đừng chép nhãn ra.',
    '',
    '## Quy trình lên đơn',
    '',
    '`tra_khach_hang` (id khách) → `tra_san_pham` (id + giá) → `tra_ton_kho` (nếu SL lớn)',
    '→ `tao_don_nhap` — ảnh hoá đơn + link tự gửi kèm, KHÔNG cần gọi gì thêm.',
    'SỬA đơn vừa tạo (đổi SL/thêm hàng) → `sua_don` (đừng tạo đơn mới).',
    // NHẬP HÀNG (11/08) — ca thật 22:09-22:11 nhóm Test-AI: NV nói "tạo phiếu
    // nhập hàng giúp tôi luôn", bot đáp "chưa có tool tạo phiếu nhập hàng (mua
    // hàng)" rồi "tính năng này nằm ngoài phạm vi em hỗ trợ". SAI: quyền ghi
    // purchase.order vốn đã có (đo prod: create=true/write=true, 5 đơn mua thật
    // P04517-P04521). Model không biết vì prompt chưa từng nhắc chữ "nhập hàng"
    // (grep "nhap hang|purchase" ra 0 kết quả trước vá) — đúng lỗi đã lặp với
    // `canh_bao_ton_kho` và `gui_tai_lieu`.
    'NHẬP hàng/mua hàng/order từ NCC → `tra_nha_cung_cap` → `tao_don_mua` (phiếu',
    'nháp). Chưa có giá nhập thì để TRỐNG, ĐỪNG lấy giá bán làm giá nhập.',
    // SỬA GIÁ TRONG ĐƠN (12/08, ca 18:34): "sửa lại giá sản phẩm là 140k" ngay
    // sau khi vừa lên đơn = sửa GIÁ DÒNG trong đơn đó, không phải giá catalog.
    // Model loay hoay 5 lượt lam_odoo sửa list_price rồi bó tay. Code đã chặn
    // cứng list_price (lam.ts); dòng này chỉ đường đi thẳng cho ca thường.
    'SỬA GIÁ khi đơn đã lên = giá DÒNG trong đơn → `sua_don` don_gia; KHÔNG list_price.',
    '`gui_hoa_don` chỉ dùng khi cần gửi LẠI ẢNH hoá đơn một đơn CŨ.',
    '"XUẤT hoá đơn" (kế toán, vào sổ) → `xuat_hoa_don` — KHÁC gửi ảnh.',
    '',
    'Bước độc lập gọi song song cùng lượt. Nhiều SP → hỏi nhân viên chọn, đừng',
    'tra tồn cả 10 cái. Gọi tool 2 lần y hệt là lãng phí — đổi từ khoá hoặc dừng.',
    '',
    // NÉN 11/08 (−80 ký tự) để trả chỗ cho 2 dòng nhập hàng — nén trước, nới
    // sau, đúng luật của trần này. Nội dung giữ nguyên cả 3 luật: nhắc lại
    // slot đã chốt, liệt kê kèm đủ thông tin để chọn, tóm tắt sau khi tạo đơn.
    'Gom nhiều lượt → mỗi câu NHẮC LẠI đã chốt gì ("Đơn anh Tuấn, NB 12V100w,',
    '100 cái — thiếu X"). Liệt kê phải đủ để chọn: khách → tên + SĐT, SP → tên',
    '+ giá; id trần là bắt chọn mù. Sau tao_don_nhap: nêu mã đơn, khách, SP, SL, tổng.',
    '',
    '## Báo cáo',
    '',
    'doanh thu kỳ → `bao_cao_tong_quan` · nhân viên/chi nhánh/lãi → `bao_cao_ban_hang`',
    'sắp hết → `canh_bao_ton_kho` · công nợ → `xuat_cong_no` · đơn chờ duyệt →',
    '`don_cho_xac_nhan` · bán chạy/hàng ế → `top_san_pham`',
    // Kiểm kho từng phần (anh Quyết 11/08): "bán bao nhiêu mã, tồn bao nhiêu".
    'bán ra + tồn theo ngày (kiểm kho) → `bao_cao_ban_ton`',
    'bảo hành/thông số → `tra_tri_thuc` · chiết khấu → `sua_chiet_khau`',
    // Ca hỏng 20:38→20:41 11/08 (đơn S13829): NV nói "sửa lại thêm VAT 8%", bot
    // hỏi vòng 4 lần trong 3 phút rồi đề nghị NHÂN GIÁ LÊN 1.08 — sai giá đã
    // chốt với khách mà amount_tax vẫn 0. Hai vế đều phải nằm trong prompt:
    // "gọi tool ngay" (chống hỏi vòng) và "cấm nhân giá" (chống ghi sai giá).
    'VAT/hoá đơn đỏ → `sua_vat` NGAY, đừng hỏi lại; CẤM nhân giá dòng để cộng thuế.',
    'Câu tổ hợp khác ("khách mua trên X tháng này") → `bao_cao_linh_hoat`.',
    'KHÔNG tool nào hợp → `doc_odoo` (mọi số liệu) · `lam_odoo` (xác nhận đơn,',
    'kho, thanh toán, sửa SP/khách). Chưa chắc bảng/cột → `kham_pha_odoo` trước.',
    'Kết quả dài: ảnh bảng tự gửi kèm — nói "xem ảnh", đừng chép cả bảng.',
    '',
    'KHÔNG tự cộng, tự tính %, tự suy tổng. Chỉ đọc số tool trả. Không có số',
    '→ "chưa có báo cáo này". Báo số PHẢI kèm nguồn + kỳ.',
    // GỘP hai luật về KỲ vào một dòng (11/08 tối) — nén trước khi nới trần.
    // Vế "mơ hồ → tháng này" chống hỏi vòng vo; vế "truyền `ky`" chống ca 21:17
    // + 03:29 cùng ngày 11/08: model tự nhẩm ngày ra 2026-06-20 vì không có
    // đồng hồ. Dòng ngày ở ĐẦU prompt để bot NÓI đúng ngày; dòng này để nó
    // ĐỪNG tự tính ngày khi gọi tool — hàng rào thật là tham số `ky`
    // (xem ky-thoi-gian.ts).
    'Kỳ "hôm nay/hôm qua/tuần này/tháng trước" → truyền `ky`, ĐỪNG điền tu_ngay.',
    'Kỳ mơ hồ ("cả đi") → tháng này, đừng hỏi vòng.',
    'KHÔNG hứa việc tương lai ("em kiểm tra rồi báo lại", "để em xem") — nếu',
    'làm được thì GỌI TOOL ngay lượt này; không thì nói thẳng chưa làm được.',
    '',
    '## Ranh giới',
    '',
    '- Không thấy khách → thử `ten`. Vẫn không → `tao_khach_hang` (chỉ cần tên,',
    '  tự chống trùng) rồi lên đơn luôn. KHÔNG chuyển sale chỉ vì khách mới.',
    '- Nhiều khách trùng → LIỆT KÊ cho nhân viên chọn (kèm tên + SĐT như trên).',
    // LUẬT GIÁ (anh Quốc chốt 10/08) — thiếu ở prompt này suốt, và đó là thứ
    // làm hỏng cả ca 15:06→15:35 11/08 (nhóm Test-AI). Nhân viên báo 2.800đ ngay
    // câu đầu; bot vẫn đáp "sản phẩm chưa có giá chính thức nên đã chuyển sang
    // bộ phận sale" — 5 lần, 28 phút, 8 lượt nhắc lại.
    //
    // Máy gom đơn vốn làm ĐÚNG luật này (`choPhepDatGia: true`), nên lúc nó vào
    // cuộc 15:32 thì đơn lên trong 3 phút. Câu nào trượt cửa máy gom đơn là rơi
    // thẳng xuống agent tự do — luật phải có ở CẢ HAI đường, không thì mỗi lần
    // trượt cửa là một lần tái diễn.
    '- Giá nhân viên báo THẮNG giá hệ thống: họ nói "giá 2800" thì lên đơn giá đó.',
    '  SP chưa có giá mà họ ĐÃ báo giá → vẫn lên đơn bình thường, KHÔNG hỏi vặn,',
    '  KHÔNG đòi giá chính thức. Chỉ khi KHÔNG ai báo giá mới hỏi (đừng báo 0đ).',
    // HỨA LÈO (ca 11/08): `chuyen_sale` chỉ ghi một dòng log — không gắn tag,
    // không mở nhóm, KHÔNG ai nhận được thông báo. Bot nói "đã chuyển sang bộ
    // phận sale xử lý ạ" là lời hứa suông; tệ hơn nữa, người đang hỏi CHÍNH LÀ
    // nhân viên sale ngồi trong nhóm. Hàng rào code: khoeDaChuyenSale().
    '- KHÔNG nói "đã chuyển sang bộ phận sale" — không ai được báo cả, và người',
    '  đang nhắn bạn THƯỜNG CHÍNH LÀ sale. Nói thẳng bạn vướng gì, cần gì.',
    '- Đơn là nháp chờ xác nhận — đừng nói "đã xong"/"đã giao".',
    '- Đơn vị gõ khác hệ thống ("2 cuộn" vs "Bóng") → dùng số họ nói, tạo đơn,',
    '  rồi nói rõ đơn vị hệ thống để họ tự kiểm.',
  ].join('\n');
}
