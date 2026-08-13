// SPDX-License-Identifier: AGPL-3.0-or-later
// Map câu chọn của NV lên ứng viên trong phiên — CODE TRƯỚC, LLM SAU.
// Orchestrator chỉ gọi LLM trích slot khi hàm này trả false; nhờ vậy "1a",
// "KH001017", SĐT... đi đường tất định, không tốn lượt model, không sai được.
//
// Quy ước đánh số PHẢI khớp loi-nhan.ts: khách = 1..n, SP = a..z.
import type { PhienGom } from './kieu.js';
import { boDau } from '../../../odoo/tools/tra-san-pham.js';
import { laMaKh } from '../../../odoo/tools/tra-khach-hang.js';

const chuCai = (i: number) => String.fromCharCode(97 + i); // 0→a, 1→b…

/**
 * Tìm phần tử khớp DUY NHẤT theo mảnh chữ (bỏ dấu). Ưu tiên khớp ĐỦ mọi mảnh
 * ("Trần Hưng" → đúng người tên chứa cả "trần" lẫn "hưng"); không ai khớp đủ
 * thì mới xét khớp một phần ("cái 24V" → SP chứa "24v"). Nhiều hơn 1 → null,
 * KHÔNG chốt bừa — thà hỏi lại còn hơn lên đơn nhầm (bug S13810).
 */
/**
 * Câu báo "đây là khách MỚI" — không phải câu chọn trong danh sách.
 *
 * Bắt cả biến thể có dấu/không dấu và câu dài hơn ("anh này khách mới nhé").
 */
const LA_KHACH_MOI = /\bkhach(\s+hang)?\s+moi\b/;

/**
 * Ứng viên DUY NHẤT có tên xuất hiện gần trọn vẹn trong câu.
 *
 * "Gần trọn" chứ không phải khớp cứng: tên Odoo hay có đuôi đơn vị/ghi chú
 * ("Nguồn NB Ngoài Trời 12V100W (cái)") mà nhân viên không gõ. Lấy phần tên bỏ
 * ngoặc, yêu cầu MỌI từ của nó đều có mặt trong câu VÀ tên đủ dài (≥3 từ hoặc
 * ≥12 ký tự) — tên ngắn như "Anh Thức" thì mọi ứng viên đều khớp, vô nghĩa.
 *
 * Khớp nhiều hơn một → trả null: mơ hồ thì để nhân viên chọn, đừng đoán.
 */
function khopTenDayDu<T>(
  ds: T[] | undefined,
  cau: string,
  layTen: (x: T) => string,
): T | null {
  if (!ds?.length) return null;
  const c = boDau(cau);
  const dung = ds.filter((x) => {
    // Bỏ phần trong ngoặc: "(cái)", "(cuộn)" — nhân viên không gõ những chữ đó.
    const ten = boDau(layTen(x)).replace(/\([^)]*\)/g, ' ').trim();
    const tu = ten.split(/\s+/).filter((t) => t.length >= 2);
    // Tên quá ngắn thì "chứa đủ từ" là bằng chứng yếu — để đường dò mảnh lo.
    if (tu.length < 3 && ten.replace(/\s+/g, '').length < 12) return false;
    return tu.every((t) => c.includes(t));
  });
  return dung.length === 1 ? dung[0] : null;
}

/** Phiên có danh sách nào đang treo chờ nhân viên chọn không. */
export function dangChoChon(p: PhienGom): boolean {
  return Boolean(
    p.khachUngVien?.length || p.donUngVien?.length || p.dong.some((d) => d.ungVien?.length),
  );
}

/**
 * Gộp các dòng đã chốt về CÙNG một sản phẩm thật (cùng `product_id`).
 *
 * Ca thật 11:58:16 ngày 12/08: bot hỏi "lấy mấy cái led thanh 1m 5054 trắng
 * (thanh), led thanh 1m 5054 trắng (thanh) ạ?" — MỘT sản phẩm in hai lần, vì
 * bug B ở trên đã đẻ ra hai dòng gom ("led thanh 1m" và "led thanh 1") rồi cả
 * hai cùng chốt về id 101. Để nguyên là đơn Odoo có hai dòng y hệt nhau, tức
 * bán gấp đôi số hàng nhân viên định bán.
 *
 * Gộp ở ĐÂY chứ không ở lúc tạo đơn: nhân viên phải THẤY con số đúng ngay
 * trong câu hỏi/tóm tắt, không phải phát hiện sau khi đơn đã lên.
 *
 * Quy tắc gộp — giữ thứ tự dòng ĐẦU, và không bao giờ làm mất dữ liệu:
 *   · SL: lấy tổng nếu cả hai đều có số; một bên trống thì lấy bên có.
 *     Hai dòng chồng nhau do bug thì một bên luôn trống → ra đúng SL gốc.
 *   · giá/chiết khấu: dòng sau chỉ đắp vào ô dòng đầu còn TRỐNG.
 *   · dòng TẶNG không bao giờ gộp với dòng BÁN (luật 11/08) — "10 cái giá
 *     2300k tặng 1 cái" là hai dòng thật, gộp là mất 10 cái đang bán.
 */
function gopDongTrung(p: PhienGom): void {
  const giu: PhienGom['dong'] = [];
  for (const d of p.dong) {
    const cu = d.daChot
      ? giu.find((x) => x.daChot?.id === d.daChot!.id && Boolean(x.tang) === Boolean(d.tang))
      : undefined;
    if (!cu) { giu.push(d); continue; }
    if (cu.sl == null) cu.sl = d.sl;
    else if (d.sl != null) cu.sl += d.sl;
    if (cu.donGia == null && d.donGia != null) cu.donGia = d.donGia;
    if (cu.chietKhau == null && d.chietKhau != null) cu.chietKhau = d.chietKhau;
  }
  p.dong = giu;
}

function khopDuyNhat<T>(ds: T[] | undefined, manh: string[], ten: (x: T) => string): T | null {
  if (!ds || manh.length === 0) return null;
  const du = ds.filter((x) => manh.every((m) => boDau(ten(x)).includes(m)));
  if (du.length === 1) return du[0];
  if (du.length > 1) return null;
  const mot = ds.filter((x) => manh.some((m) => boDau(ten(x)).includes(m)));
  return mot.length === 1 ? mot[0] : null;
}

/**
 * ÁP LỰA CHỌN DO MODEL ĐỀ XUẤT (kênh chon_khach/chon_sp — "tai linh động",
 * 12/08 tối). Model đọc câu mềm ("lấy loại rẻ nhất") + danh sách bot vừa hỏi
 * rồi quy ra số/chữ; hàm này VALIDATE từng đề xuất bằng đúng luật phạm vi của
 * apDungChon — đề xuất lệch phạm vi thì bỏ qua ô đó, không phá gì.
 * '?' là giữ-chỗ cho nhóm model không chắc — nhảy qua, giữ đúng THỨ TỰ nhóm.
 */
export function apChonDeXuat(
  p: PhienGom,
  chonKhach?: number,
  chonSp?: string[],
): boolean {
  let map = false;
  if (chonKhach != null && p.khachUngVien?.length) {
    const k = p.khachUngVien[chonKhach - 1];
    if (k) {
      p.khachDaChot = { id: k.id, ten: k.ten, ma: k.ma, dienThoai: k.dienThoai };
      delete p.khachUngVien;
      map = true;
    }
  }
  const nhomTreo = p.dong.filter((d) => d.ungVien?.length);
  (chonSp ?? []).forEach((chu, i) => {
    if (chu === '?') return;
    const ung = nhomTreo[i]?.ungVien;
    const idx = chu.charCodeAt(0) - 97;
    if (ung && idx >= 0 && idx < ung.length) {
      const sChon = ung[idx];
      nhomTreo[i].daChot = { id: sChon.id, ten: sChon.ten, gia: sChon.gia };
      delete nhomTreo[i].ungVien;
      map = true;
    }
  });
  if (map) gopDongTrung(p);
  return map;
}

/**
 * Áp câu của NV vào các lựa chọn đang chờ. Mutate phiên khi chốt được.
 * Trả `true` nếu map được ít nhất một lựa chọn.
 */
export function apDungChon(p: PhienGom, cauTho: string): boolean {
  const cau = cauTho.trim();
  if (!cau) return false;
  let map = false;

  // ── Chế SỬA: chọn ĐƠN trước (số thứ tự hoặc mã đơn S13820) ──
  if (p.donUngVien?.length) {
    const soDon = cau.match(/^(\d{1,2})$/);
    const maDon = cau.toUpperCase().match(/\bS\d{3,}\b/);
    const chon = soDon
      ? p.donUngVien[Number(soDon[1]) - 1]
      : maDon
        ? p.donUngVien.find((d) => d.ma.toUpperCase() === maDon[0])
        : undefined;
    if (chon) {
      p.donSua = chon;
      delete p.donUngVien;
      return true; // chọn đơn xong là đủ cho lượt này
    }
  }

  // ── "1a", "2", "b", "1 a", "a, b" — số chốt khách, chữ chốt SP ──
  //
  // MỘT CHỮ ỨNG VỚI MỘT NHÓM HỎI, theo thứ tự (sửa 12/08). Trước đây mọi chữ
  // đều đổ vào `p.dong.find(...)` — tức luôn là nhóm ĐẦU TIÊN còn chờ — nên
  // "a, b" chốt hai lần lên cùng một dòng, chữ sau đè chữ trước. Bot in danh
  // sách a/b/c cho TỪNG nhóm thì chữ phải đếm theo nhóm mới khớp cái nhân viên
  // nhìn thấy.
  //
  // MỖI CHỮ PHẢI ĐỨNG RIÊNG (regex dưới đọc theo TỪ, không gộp cả câu rồi bóc
  // chữ). "Anh Long Led" bỏ hết dấu cách ra "anhlonged" — toàn chữ cái, nên nếu
  // gộp trước thì nó lọt vào đây và bị coi là câu chọn a/n/h/l/o/n/g… Đó là ca
  // thật 16:16 11/08 (tên khách nằm ngoài trang đầu, phải tra lại bằng tên đầy
  // đủ); nuốt nó là dựng lại đúng bug cũ. Câu chọn thật luôn là những mẩu MỘT
  // ký tự: "1a", "a", "a, b", "1 a".
  // "1aaaaaa" / "1 a a a a" / "tất cả a" — CHỌN HÀNG LOẠT (vá 22:54 12/08).
  //
  // Ca thật: bot hỏi NCC (2 lựa chọn) + 6 nhóm SP một lượt; anh Quốc gõ
  // "1aaaaaa theo thứ tự từ trên xuống" — ý rõ như ban ngày (1 cho NCC, sáu
  // chữ a cho sáu nhóm) mà máy từ chối vì regex chỉ cho MỘT chữ mỗi token.
  // Đã dồn nhiều câu hỏi vào một tin thì phải nhận được câu trả lời gộp.
  //
  // AN TOÀN GIỮ NGUYÊN (bug "Anh Long Led" 16:16 11/08): chuỗi chữ liền chỉ
  // được coi là câu chọn khi TỪNG CHỮ nằm đúng phạm vi ứng viên của nhóm
  // tương ứng — "anh" có 'n','h' vượt phạm vi a-c nên vẫn đi đường tra tên
  // như cũ, không bị nuốt.
  const nhomTreo = p.dong.filter((d) => d.ungVien?.length);
  const chuHopLe = (chu: string, viTri: number): boolean => {
    const ung = nhomTreo[viTri]?.ungVien;
    if (!ung?.length) return false;
    const idx = chu.charCodeAt(0) - 97;
    return idx >= 0 && idx < ung.length;
  };

  // "tất cả a" / "chọn hết a" / "toàn bộ a" → chữ đó áp cho MỌI nhóm đang treo.
  const catCa = boDau(cau).match(/^(tat ca|chon het|toan bo|het)\s+([a-z])$/);
  if (catCa && nhomTreo.length > 0 && nhomTreo.every((_, i) => chuHopLe(catCa[2], i))) {
    for (const dong of nhomTreo) {
      const idx = catCa[2].charCodeAt(0) - 97;
      const s = dong.ungVien![idx];
      dong.daChot = { id: s.id, ten: s.ten, gia: s.gia };
      delete dong.ungVien;
    }
    gopDongTrung(p);
    return true;
  }

  // '-' cũng là dấu ngăn lựa chọn (ca thật 19:53 12/08: NV gõ "1-b" bị từ
  // chối rồi lặp danh sách). "NB-12V400W" không bị ảnh hưởng: tách ra
  // ["nb","12v400w"] vẫn trượt mẫu chọn nên đi đường tra tên như cũ.
  const tuChon = cau.toLowerCase().split(/[\s,.+&-]+|\bvà\b/).filter(Boolean);
  // Token hợp lệ: "1", "1a", "a" như cũ, HOẶC số+nhiều chữ ("1aaaaaa") /
  // chuỗi chữ liền ("aab") — hai dạng mới phải qua kiểm phạm vi bên dưới.
  const laMauChon = tuChon.length > 0
    && tuChon.every((t) => /^\d{1,2}[a-z]*$|^[a-z]+$/.test(t));
  const gon = laMauChon ? tuChon.join('') : '';
  const soChu = laMauChon ? gon.match(/^(\d{1,2})?([a-z]*)$/) : null;
  let chuChon = soChu?.[2] ?? '';
  // KIỂM PHẠM VI cho chuỗi >1 chữ: từng chữ phải chỉ đúng một ứng viên có
  // thật của nhóm tương ứng. Một chữ lệch → cả câu KHÔNG phải câu chọn
  // ("anh", "ok"…) — trả về đường tra tên/LLM, tuyệt đối không nuốt.
  if (chuChon.length > 1) {
    const khopPhamVi = chuChon.length <= nhomTreo.length
      && [...chuChon].every((c, i) => chuHopLe(c, i));
    // Lệch phạm vi → phần chữ VÔ HIỆU nhưng KHÔNG return sớm: "anh long led"
    // phải chảy tiếp xuống các tầng dò-tên bên dưới (tầng 3 tra lại tên đầy
    // đủ — ca 16:15 11/08); return ở đây là cắt cụt đường cứu đó.
    if (!khopPhamVi) chuChon = '';
  }
  if (soChu && (soChu[1] || chuChon)) {
    if (soChu[1] && p.khachUngVien) {
      const k = p.khachUngVien[Number(soChu[1]) - 1];
      if (k) {
        p.khachDaChot = { id: k.id, ten: k.ten, ma: k.ma, dienThoai: k.dienThoai };
        delete p.khachUngVien;
        map = true;
      }
    }
    // Chữ thứ i ứng với nhóm hỏi thứ i (nhóm = dòng còn `ungVien`).
    const nhom = p.dong.filter((d) => d.ungVien?.length);
    for (let i = 0; i < chuChon.length && i < nhom.length; i++) {
      const dong = nhom[i];
      const idx = dong.ungVien?.findIndex((_, j) => chuCai(j) === chuChon[i]) ?? -1;
      const s = idx >= 0 ? dong.ungVien?.[idx] : undefined;
      if (s) {
        dong.daChot = { id: s.id, ten: s.ten, gia: s.gia };
        delete dong.ungVien;
        map = true;
      }
    }
    if (map) { gopDongTrung(p); return true; }

    // CÂU CHỌN KHÔNG KHỚP ĐƯỢC GÌ VẪN LÀ CÂU CHỌN — NUỐT, ĐỪNG TRẢ VỀ LLM.
    //
    // Ca thật 11:53:54 ngày 12/08 (anh Quốc: "càng sửa càng lỗi à"). Bot vừa
    // hỏi 'chọn giúp em (vd: 1a)'; lượt trước nhân viên gõ "1" đã chốt khách
    // nên `khachUngVien` biến mất. Lượt sau họ gõ "1" lần nữa: số không còn
    // nhánh nào để chạy → hàm trả FALSE → orchestrator hỏi LLM → model thấy
    // "1" trơ trọi giữa phiên đang hỏi "led thanh 1m…" nên trả về
    // `dong:[{sp:"led thanh 1"}]`. `dapSlot` đẩy thêm một dòng gom, và bot đẻ
    // ra nhóm hỏi THỨ HAI cho cùng món hàng (11:54:05). Từ đó mỗi lượt chọn
    // lại sinh thêm một nhóm — nhân viên không bao giờ thoát được vòng hỏi.
    //
    // Một câu chỉ gồm số/chữ cái đơn, gõ đúng lúc danh sách đang treo, KHÔNG
    // BAO GIỜ là tên sản phẩm. Nuốt nó (trả true) là mất một lượt, còn thả cho
    // model đoán là hỏng cả phiên. Trả true cũng khiến luồng in lại danh sách
    // đang treo — đúng thứ nhân viên cần nhìn để chọn lại cho đúng.
    //
    // HẸP có chủ ý: chỉ nuốt khi THẬT SỰ có danh sách đang chờ. Phiên không
    // chờ chọn gì thì "1" vẫn về LLM như cũ ("1 cái nữa em" phải chạy được).
    if (dangChoChon(p)) return true;
  }

  // ── Mã KH / MÃ NCC / SĐT khớp đúng một ứng viên ──
  //
  // MÃ NCC (11/08): ca thật 23:16:53 — bot đang liệt kê 2 nhà cung cấp, nhân
  // viên gõ đúng mã "NCC000001" (ref thật của id=314, đo prod) mà máy không
  // nhận, câu rơi xuống LLM và bot quay về hỏi lại từ đầu luồng.
  //
  // `laMaKh` vốn đã khớp được "NCC000001" về mặt hình dạng (chữ+số), nhưng chỉ
  // được gọi trên nhánh khách — và ở chế nhập, `khachUngVien` CHÍNH LÀ danh sách
  // NCC (xem kieu.ts). Nên chỉ cần so `ref` là đủ, không cần luật riêng.
  //
  // So khớp cả dạng ref TỰ DO: đo prod 200 NCC thì 186 dùng "NCC######", 2 dùng
  // "KH######", số còn lại lấy luôn tên làm ref ("cát tường", "Giang Led"). Vì
  // vậy điều kiện là "câu TRÙNG KHỚP ref của đúng một ứng viên", không khoá cứng
  // tiền tố NCC — khoá cứng là bỏ sót 14 nhà cung cấp thật.
  if (p.khachUngVien) {
    const soTrong = cau.replace(/[^\d]/g, '');
    const khop = p.khachUngVien.filter(
      (k) =>
        k.ma?.toLowerCase() === cau.toLowerCase() ||
        (laMaKh(cau) && k.ma?.toLowerCase() === cau.toLowerCase()) ||
        (soTrong.length >= 9 && k.dienThoai?.replace(/[^\d]/g, '').endsWith(soTrong.slice(-9))),
    );
    if (khop.length === 1) {
      const k = khop[0];
      p.khachDaChot = { id: k.id, ten: k.ten, ma: k.ma, dienThoai: k.dienThoai };
      delete p.khachUngVien;
      map = true;
    }
  }

  // ── Câu DÀI nhưng chứa TÊN ĐẦY ĐỦ của đúng một ứng viên → chốt luôn ──
  //
  // Bug thật 21:21:40 10/08: bot hỏi chọn 3 loại nguồn NB, nhân viên gõ
  // "khách mới, Nguồn NB Ngoài Trời 12V100W 170k nhé" — 9 từ nên guard 4 từ ở
  // dưới chặn, bot hỏi lại y hệt a/b/c. Anh Quốc: "tôi cảm giác nó đang cứng
  // ngắc à rõ ràng tôi đã nhắn ... luôn rồi".
  //
  // Vì sao KHÔNG nới guard 4 từ: nó chống bug S13814 (mảnh "hoà" trong câu dài
  // khớp địa chỉ "hiệp hoà" → chốt nhầm khách). Nới ra là mở lại đúng lỗ đó.
  // Thay vào đó dùng bằng chứng MẠNH HƠN HẲN: cả cụm tên xuất hiện nguyên vẹn
  // trong câu. Một mảnh chữ lẻ trùng là tình cờ; nguyên cụm "nguon nb ngoai
  // troi 12v100w" nằm trong câu thì không thể là tình cờ.
  if (p.khachUngVien) {
    const k = khopTenDayDu(p.khachUngVien, cau, (x) => x.ten);
    if (k) {
      p.khachDaChot = { id: k.id, ten: k.ten, ma: k.ma, dienThoai: k.dienThoai };
      delete p.khachUngVien;
      map = true;
    }
  }
  for (const dong of p.dong) {
    const s = khopTenDayDu(dong.ungVien, cau, (x) => x.ten);
    if (s) {
      dong.daChot = { id: s.id, ten: s.ten, gia: s.gia };
      delete dong.ungVien;
      map = true;
    }
  }

  // ── MÃ KỸ THUẬT trong câu khớp duy nhất một SP → chốt, dù câu dài ──
  //
  // Anh Quốc hỏi 10/08: "ví dụ tôi nói 12V100W 170k thì sao??" — đó mới là
  // cách gõ thật, không ai chép lại nguyên tên dài. "12V100W 170k" (2 mảnh)
  // lọt guard nên đường dưới lo được, nhưng "lấy con 100W 170k nhé" (5 mảnh)
  // thì không — mà ý nghĩa y hệt.
  //
  // Mã kỹ thuật là token CÓ CHỮ SỐ dính chữ (100w, 12v300w, 5050, 6011a). Nó
  // an toàn hơn mảnh chữ thường rất nhiều: "hoà" trùng địa chỉ là tình cờ,
  // chứ "12v100w" trùng thì không. Nhờ vậy bỏ được guard độ dài mà không mở
  // lại lỗ S13814 — ca đó không có token số nào.
  //
  // CHỈ áp cho SẢN PHẨM, không áp cho khách: tên khách không có mã kỹ thuật,
  // còn số trong câu ("170k", "10 cái") lại dễ trùng mã KH/SĐT.
  const maKyThuat = boDau(cau).split(/\s+/)
    .filter((t) => /\d/.test(t) && /[a-z]/.test(t) && t.length >= 3);
  if (maKyThuat.length > 0) {
    for (const dong of p.dong) {
      if (!dong.ungVien?.length || dong.daChot) continue;
      const khop = dong.ungVien.filter((sp) => {
        const ten = boDau(sp.ten).replace(/[^a-z0-9]/g, '');
        return maKyThuat.some((m) => ten.includes(m.replace(/[^a-z0-9]/g, '')));
      });
      if (khop.length === 1) {
        dong.daChot = { id: khop[0].id, ten: khop[0].ten, gia: khop[0].gia };
        delete dong.ungVien;
        map = true;
      }
    }
  }

  // ── Mảnh chữ khớp DUY NHẤT một ứng viên (khách hoặc từng dòng SP) ──
  //
  // CHỈ với câu NGẮN kiểu câu chọn ("cái 24V", "Trần Hưng"). Câu dài là lệnh/
  // câu nói thường — dò mảnh trên đó từng chốt NHẦM khách: "xuất hóa đơn LUÔN
  // giúp tôi nhé" có chữ "hoà" khớp địa chỉ "hiệp hoà, Bắc giang" của đúng một
  // ứng viên → đơn S13814 sai người (bug thật 23:16 07/08).
  // "khách mới" KHÔNG phải câu chọn — nó là lệnh "đừng chọn ai cả, tạo người
  // mới". Bug thật 17:08 10/08: bot hỏi chọn trong 10 anh Chiến, nhân viên đáp
  // "khách mới"; câu 2 chữ lọt guard 4 từ rồi bị đem đi dò mảnh tên. Ở đây tên
  // ứng viên không chứa "moi" nên chỉ trơ ra (bot lặp lại danh sách), nhưng
  // khách thật tên "Mới"/"Khánh" là chốt nhầm luôn — cùng họ lỗi S13814.
  // Trả nguyên trạng để LLM trích ra `khachMoi` và máy đi nhánh tạo khách.
  if (LA_KHACH_MOI.test(boDau(cau))) { if (map) gopDongTrung(p); return map; }

  const manh = boDau(cau)
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  if (manh.length > 4) { if (map) gopDongTrung(p); return map; }
  if (p.khachUngVien) {
    const k = khopDuyNhat(p.khachUngVien, manh, (x) => x.ten);
    if (k) {
      p.khachDaChot = { id: k.id, ten: k.ten, ma: k.ma, dienThoai: k.dienThoai };
      delete p.khachUngVien;
      map = true;
    }
  }
  for (const dong of p.dong) {
    const s = khopDuyNhat(dong.ungVien, manh, (x) => x.ten);
    if (s) {
      dong.daChot = { id: s.id, ten: s.ten, gia: s.gia };
      delete dong.ungVien;
      map = true;
    }
  }
  if (map) gopDongTrung(p);
  return map;
}
