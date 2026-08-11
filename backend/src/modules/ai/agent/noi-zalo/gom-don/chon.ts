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

function khopDuyNhat<T>(ds: T[] | undefined, manh: string[], ten: (x: T) => string): T | null {
  if (!ds || manh.length === 0) return null;
  const du = ds.filter((x) => manh.every((m) => boDau(ten(x)).includes(m)));
  if (du.length === 1) return du[0];
  if (du.length > 1) return null;
  const mot = ds.filter((x) => manh.some((m) => boDau(ten(x)).includes(m)));
  return mot.length === 1 ? mot[0] : null;
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

  // ── "1a", "2", "b", "1 a" — số chốt khách, chữ chốt SP dòng đầu còn chờ ──
  const gon = cau.toLowerCase().replace(/\s+/g, '');
  const soChu = gon.match(/^(\d{1,2})?([a-z])?$/);
  if (soChu && (soChu[1] || soChu[2])) {
    if (soChu[1] && p.khachUngVien) {
      const k = p.khachUngVien[Number(soChu[1]) - 1];
      if (k) {
        p.khachDaChot = { id: k.id, ten: k.ten, ma: k.ma, dienThoai: k.dienThoai };
        delete p.khachUngVien;
        map = true;
      }
    }
    if (soChu[2]) {
      const dong = p.dong.find((d) => d.ungVien?.length);
      const idx = dong?.ungVien?.findIndex((_, i) => chuCai(i) === soChu[2]) ?? -1;
      const s = idx >= 0 ? dong?.ungVien?.[idx] : undefined;
      if (dong && s) {
        dong.daChot = { id: s.id, ten: s.ten, gia: s.gia };
        delete dong.ungVien;
        map = true;
      }
    }
    if (map) return true;
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
  if (LA_KHACH_MOI.test(boDau(cau))) return map;

  const manh = boDau(cau)
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  if (manh.length > 4) return map;
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
  return map;
}
