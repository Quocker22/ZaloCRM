// SPDX-License-Identifier: AGPL-3.0-or-later
// Gợi ý @khách-hàng và #sản-phẩm cho ô soạn tin.
//
// VÌ SAO CẦN: nhân viên gõ "Quảng Cáo Hoàng Anh" nhưng DB có cả "Quảng cáo
// Hoàng Nam Thanh Hóa" — bot phải hỏi lại, mất một lượt. Chọn từ gợi ý thì có
// luôn tên chính xác, bot không phải đoán.
//
// KHÁC với @mention thành viên nhóm (đã có sẵn): cái đó tra Zalo, cái này tra
// Odoo. Hai nguồn khác nhau nên tách riêng.

import { ref } from 'vue';

export interface GoiYKhach {
  id: number;
  ten: string;
  maKh: string;
  sdt: string;
  congNo: number;
}

export interface GoiYSanPham {
  id: number;
  ten: string;
  ma: string;
  gia: number;
  donVi: string;
}

/**
 * Trễ trước khi gọi API (ms).
 *
 * Gõ tới đâu gọi tới đó là bắn ~10 request cho một cái tên. 150ms đủ để gộp
 * các phím gõ liền nhau mà nhân viên vẫn thấy gợi ý gần như tức thì.
 */
const TRE_GO = 150;

/** Số ký tự tối thiểu — đồng bộ với backend (`goi-y-routes.ts`). */
export const KY_TU_TOI_THIEU = 2;

/** Bộ nhớ tạm theo từ khoá: nhân viên hay xoá rồi gõ lại cùng một tên. */
const boNho = new Map<string, unknown[]>();

/** Xoá cache — gọi khi dữ liệu Odoo có thể đã đổi (vd sau khi lên đơn). */
export function xoaBoNhoGoiY(): void {
  boNho.clear();
}

async function goiApi<T>(duong: string, q: string): Promise<T[]> {
  const khoa = `${duong}?${q}`;
  const cu = boNho.get(khoa);
  if (cu) return cu as T[];

  const res = await fetch(`${duong}?q=${encodeURIComponent(q)}`, {
    credentials: 'include',
  });
  // Lỗi KHÔNG được chặn ô chat: trả rỗng, nhân viên gõ tay như trước.
  if (!res.ok) return [];

  const body = (await res.json()) as { items?: T[] };
  const items = Array.isArray(body?.items) ? body.items : [];
  boNho.set(khoa, items);
  return items;
}

/**
 * Tra có gộp phím gõ (debounce).
 *
 * Trả về hàm `tra(q)` — mỗi lần gọi huỷ lần chờ trước đó. Nếu một request cũ về
 * SAU request mới, kết quả cũ bị bỏ (chống hiện gợi ý của từ khoá đã gõ xong).
 */
export function useGoiYCrm() {
  const dangTai = ref(false);
  let hen: ReturnType<typeof setTimeout> | null = null;
  let luot = 0;

  const tra = <T>(duong: string, q: string): Promise<T[]> => {
    const tu = q.trim();
    if (hen) clearTimeout(hen);
    if (tu.length < KY_TU_TOI_THIEU) {
      dangTai.value = false;
      return Promise.resolve([]);
    }

    const cuaToi = ++luot;
    dangTai.value = true;

    return new Promise<T[]>((resolve) => {
      hen = setTimeout(async () => {
        try {
          const kq = await goiApi<T>(duong, tu);
          // Request cũ về sau request mới → bỏ, tránh nháy gợi ý sai.
          resolve(cuaToi === luot ? kq : []);
        } catch {
          resolve([]);
        } finally {
          if (cuaToi === luot) dangTai.value = false;
        }
      }, TRE_GO);
    });
  };

  return {
    dangTai,
    traKhach: (q: string) => tra<GoiYKhach>('/api/goi-y/khach', q),
    traSanPham: (q: string) => tra<GoiYSanPham>('/api/goi-y/san-pham', q),
  };
}

/** VND không thập phân — quy ước toàn hệ thống. */
export function dinhDangTien(n: number): string {
  return `${Math.round(n).toLocaleString('vi-VN')}đ`;
}

/**
 * Nhãn giá cho gợi ý sản phẩm.
 *
 * SP giá ≤ 10đ là placeholder khi nhập liệu (63 SP để đúng 1đ), KHÔNG phải giá
 * bán. Hiện "1đ" khiến nhân viên tưởng bán 1 đồng thật.
 */
export function nhanGia(gia: number): string {
  if (gia <= 0) return 'chưa có giá';
  if (gia <= 10) return 'giá tạm';
  return dinhDangTien(gia);
}
