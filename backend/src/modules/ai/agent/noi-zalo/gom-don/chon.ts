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

  // ── Mã KH / SĐT khớp đúng một ứng viên khách ──
  if (p.khachUngVien) {
    const soTrong = cau.replace(/[^\d]/g, '');
    const khop = p.khachUngVien.filter(
      (k) =>
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

  // ── Mảnh chữ khớp DUY NHẤT một ứng viên (khách hoặc từng dòng SP) ──
  const manh = boDau(cau)
    .split(/\s+/)
    .filter((t) => t.length >= 2);
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
