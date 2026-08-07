# Luồng lên đơn máy trạng thái slot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Luồng "lên đơn" của nhân viên chạy bằng máy trạng thái code (slot-form); LLM chỉ trích slot. Chat hỏng 21:07 07/08 thành kịch bản replay chạy tự động.

**Architecture:** Module mới `src/modules/ai/agent/noi-zalo/gom-don/` — hàm thuần `buocTiepTheo` quyết định hành động kế tiếp từ phiên; phiên lưu bảng `phien_gom_don` (TTL 15'); orchestrator cắm vào `xuLyTinNhanVien` TRƯỚC `chayLenhNhanVien`, không đụng agent thường. Tra khách + SP tái dùng `traKhachHang`/`traSanPham`; tạo đơn tái dùng `taoDonNhap` (giữ verify tên) + `guiHoaDon` (ảnh + link).

**Tech Stack:** TypeScript ESM (import đuôi `.js`), Prisma, vitest (`npm test` = unit; `vitest.func.config.ts` = LLM thật).

## Global Constraints

- Spec gốc: `docs/superpowers/specs/2026-08-07-luong-len-don-slot-design.md` — hành vi đích chốt 07/08.
- Lời gửi nhân viên là TEMPLATE code tất định — KHÔNG cho LLM soạn trong luồng này.
- Slot đã có KHÔNG hỏi lại; mọi tra cứu khách+SP chạy song song ngay khi có từ khoá.
- Không đụng: `chayLenhNhanVien`, luồng khách, guard `coTinKhachMoiHon`/`laXacNhanNgan` hiện có.
- File mới ≤ ~300 dòng/file; comment giải thích "vì sao" theo nếp repo (tiếng Việt).
- Commit message tiếng Việt kiểu `feat(nv)/fix(nv)/test(nv)`, kèm `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Kiểu + hàm thuần `buocTiepTheo`

**Files:**
- Create: `src/modules/ai/agent/noi-zalo/gom-don/kieu.ts`
- Create: `src/modules/ai/agent/noi-zalo/gom-don/buoc-tiep-theo.ts`
- Test: `tests/ai/agent/gom-don/buoc-tiep-theo.test.ts`

**Interfaces:**
- Consumes: `KhachHang` từ `tra-khach-hang.js`, `SanPham` từ `tra-san-pham.js`.
- Produces: `PhienGom`, `DongGom`, `HanhDong`, `buocTiepTheo(phien: PhienGom): HanhDong` — Task 2-7 dùng đúng các tên này.

- [ ] **Step 1: Viết kiểu** — `kieu.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Kiểu của máy trạng thái gom đơn. Spec: docs/superpowers/specs/2026-08-07-luong-len-don-slot-design.md
import type { KhachHang } from '../../../odoo/tools/tra-khach-hang.js';
import type { SanPham } from '../../../odoo/tools/tra-san-pham.js';

/** Một dòng hàng đang gom: từ khoá NV gõ → ứng viên → SP đã chốt. */
export interface DongGom {
  tuKhoa: string;
  sl: number | null;
  daChot?: Pick<SanPham, 'id' | 'ten' | 'gia'>;
  ungVien?: SanPham[];       // >1 kết quả, chờ NV chọn
  khongThay?: boolean;       // tra rồi mà 0 kết quả
}

export interface PhienGom {
  khachTuKhoa: string | null;
  khachDaChot?: Pick<KhachHang, 'id' | 'ten' | 'ma' | 'dienThoai'>;
  khachUngVien?: KhachHang[];
  khachKhongThay?: boolean;
  dong: DongGom[];
  /** Đã hiện tóm tắt, đang chờ NV chốt. */
  daHoiChot?: boolean;
}

/** Hành động kế tiếp — code quyết, KHÔNG phải model. Mỗi lượt đúng MỘT hành động gửi đi. */
export type HanhDong =
  | { loai: 'tra_cuu'; khach?: string; sp: string[] }   // chạy song song rồi gọi lại buocTiepTheo
  | { loai: 'hoi_chon' }                                 // render danh sách từ phiên
  | { loai: 'hoi_thieu'; thieu: 'khach' | 'sp' | 'sl' }
  | { loai: 'khong_thay'; khach?: string; sp: string[] } // báo không tìm thấy, xoá phần đó khỏi phiên
  | { loai: 'tom_tat_cho_chot' }
  | { loai: 'tao_don' };
```

- [ ] **Step 2: Viết test fail** — `tests/ai/agent/gom-don/buoc-tiep-theo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buocTiepTheo } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/buoc-tiep-theo.js';
import type { PhienGom } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/kieu.js';

const khach = { id: 7, ten: 'Hưng Cty A', ma: 'KH001017', dienThoai: '0901' };
const sp = { id: 3, ten: 'Nguồn NB 12V100W', gia: 185000 };

describe('buocTiepTheo — bảng trạng thái', () => {
  it('có từ khoá chưa tra → tra_cuu song song cả khách lẫn SP (kịch bản 21:07 07/08)', () => {
    const p: PhienGom = { khachTuKhoa: 'Hưng', dong: [{ tuKhoa: 'nguồn NB', sl: 10 }] };
    expect(buocTiepTheo(p)).toEqual({ loai: 'tra_cuu', khach: 'Hưng', sp: ['nguồn NB'] });
  });
  it('khách nhiều ứng viên → hoi_chon (KHÔNG hỏi SL vì SL đã có)', () => {
    const p: PhienGom = { khachTuKhoa: 'Hưng', khachUngVien: [khach, { ...khach, id: 8 }],
      dong: [{ tuKhoa: 'nguồn NB', sl: 10, daChot: sp }] };
    expect(buocTiepTheo(p)).toEqual({ loai: 'hoi_chon' });
  });
  it('đủ khách + SP nhưng thiếu SL → hoi_thieu sl', () => {
    const p: PhienGom = { khachTuKhoa: 'Hưng', khachDaChot: khach,
      dong: [{ tuKhoa: 'nguồn NB', sl: null, daChot: sp }] };
    expect(buocTiepTheo(p)).toEqual({ loai: 'hoi_thieu', thieu: 'sl' });
  });
  it('chưa nói SP nào → hoi_thieu sp', () => {
    const p: PhienGom = { khachTuKhoa: 'Hưng', khachDaChot: khach, dong: [] };
    expect(buocTiepTheo(p)).toEqual({ loai: 'hoi_thieu', thieu: 'sp' });
  });
  it('đủ hết, chưa hỏi chốt → tom_tat_cho_chot; đã hỏi → tao_don chỉ khi xác nhận (Task 6 lo)', () => {
    const p: PhienGom = { khachTuKhoa: 'Hưng', khachDaChot: khach,
      dong: [{ tuKhoa: 'nguồn NB', sl: 10, daChot: sp }] };
    expect(buocTiepTheo(p)).toEqual({ loai: 'tom_tat_cho_chot' });
    expect(buocTiepTheo({ ...p, daHoiChot: true })).toEqual({ loai: 'tao_don' });
  });
  it('tra rồi không thấy → khong_thay nêu đúng phần hỏng', () => {
    const p: PhienGom = { khachTuKhoa: 'Hưngg', khachKhongThay: true,
      dong: [{ tuKhoa: 'abc xyz', sl: 2, khongThay: true }] };
    expect(buocTiepTheo(p)).toEqual({ loai: 'khong_thay', khach: 'Hưngg', sp: ['abc xyz'] });
  });
});
```

- [ ] **Step 3: Chạy fail** — `npx vitest run tests/ai/agent/gom-don/buoc-tiep-theo.test.ts` → FAIL (module chưa có).

- [ ] **Step 4: Viết `buoc-tiep-theo.ts`** (hàm thuần, KHÔNG import prisma/odoo/logger):

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Bộ não máy trạng thái — HÀM THUẦN: phiên vào, hành động ra. Không I/O.
// Thứ tự ưu tiên: tra cứu → báo không thấy → hỏi chọn → hỏi thiếu → chốt → tạo.
import type { PhienGom, HanhDong } from './kieu.js';

export function buocTiepTheo(p: PhienGom): HanhDong {
  // 1. Còn từ khoá CHƯA TRA (chưa chốt/ứng viên/không-thấy) → tra hết một lượt.
  const khachCanTra = p.khachTuKhoa && !p.khachDaChot && !p.khachUngVien && !p.khachKhongThay
    ? p.khachTuKhoa : undefined;
  const spCanTra = p.dong.filter((d) => !d.daChot && !d.ungVien && !d.khongThay).map((d) => d.tuKhoa);
  if (khachCanTra || spCanTra.length > 0) {
    return { loai: 'tra_cuu', ...(khachCanTra ? { khach: khachCanTra } : {}), sp: spCanTra };
  }
  // 2. Tra rồi mà không thấy → báo ngay, đừng để NV chờ đến cuối mới biết.
  const spKhongThay = p.dong.filter((d) => d.khongThay).map((d) => d.tuKhoa);
  if (p.khachKhongThay || spKhongThay.length > 0) {
    return { loai: 'khong_thay', ...(p.khachKhongThay && p.khachTuKhoa ? { khach: p.khachTuKhoa } : {}), sp: spKhongThay };
  }
  // 3. Nhập nhằng → hỏi chọn MỘT lần gộp cả khách lẫn SP.
  if (p.khachUngVien?.length || p.dong.some((d) => d.ungVien?.length)) return { loai: 'hoi_chon' };
  // 4. Thiếu slot → hỏi đúng một slot, ưu tiên khách → SP → SL.
  if (!p.khachDaChot) return { loai: 'hoi_thieu', thieu: 'khach' };
  if (p.dong.length === 0) return { loai: 'hoi_thieu', thieu: 'sp' };
  if (p.dong.some((d) => d.sl == null)) return { loai: 'hoi_thieu', thieu: 'sl' };
  // 5. Đủ hết: hỏi chốt một lần, xác nhận rồi thì tạo.
  return p.daHoiChot ? { loai: 'tao_don' } : { loai: 'tom_tat_cho_chot' };
}
```

- [ ] **Step 5: Chạy pass** — cùng lệnh trên → PASS.
- [ ] **Step 6: Commit** — `git add … && git commit -m "feat(nv): bộ não máy trạng thái gom đơn — hàm thuần buocTiepTheo"`.

---

### Task 2: Map câu chọn của nhân viên

**Files:**
- Create: `src/modules/ai/agent/noi-zalo/gom-don/chon.ts`
- Test: `tests/ai/agent/gom-don/chon.test.ts`

**Interfaces:**
- Produces: `apDungChon(phien: PhienGom, cau: string): boolean` — mutate phiên (chốt ứng viên khớp), trả `true` nếu câu map được ít nhất một lựa chọn. Task 6 gọi TRƯỚC trích slot LLM.
- Quy ước danh sách đánh số: khách = `1..n`, SP dòng i = chữ cái `a..z` theo thứ tự ứng viên (khớp Task 3).

- [ ] **Step 1: Test fail**:

```ts
import { describe, it, expect } from 'vitest';
import { apDungChon } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/chon.js';
import type { PhienGom } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/kieu.js';

const h1 = { id: 7, ten: 'Hưng Cty A', ma: 'KH001017', dienThoai: '0901234567', congNo: 0 };
const h2 = { id: 8, ten: 'Trần Hưng', ma: 'KH000022', dienThoai: '0987654321', congNo: 0 };
const nb1 = { id: 3, ten: 'Nguồn NB 12V100W', ma: null, gia: 185000, donVi: null };
const nb2 = { id: 4, ten: 'Nguồn NB 24V200W', ma: null, gia: 320000, donVi: null };
const phien = (): PhienGom => ({ khachTuKhoa: 'Hưng', khachUngVien: [h1, h2],
  dong: [{ tuKhoa: 'nguồn NB', sl: 10, ungVien: [nb1, nb2] }] });

describe('apDungChon', () => {
  it('"1a" chốt khách 1 + SP a', () => {
    const p = phien();
    expect(apDungChon(p, '1a')).toBe(true);
    expect(p.khachDaChot?.id).toBe(7);
    expect(p.dong[0].daChot?.id).toBe(3);
    expect(p.khachUngVien).toBeUndefined();
  });
  it('"KH000022" chốt đúng khách theo mã, SP vẫn chờ', () => {
    const p = phien();
    expect(apDungChon(p, 'KH000022')).toBe(true);
    expect(p.khachDaChot?.id).toBe(8);
    expect(p.dong[0].ungVien).toHaveLength(2);
  });
  it('SĐT chốt khách; "cái 24V" (chứa mảnh tên duy nhất khớp) chốt SP', () => {
    const p = phien();
    expect(apDungChon(p, '0987654321')).toBe(true);
    expect(p.khachDaChot?.id).toBe(8);
    expect(apDungChon(p, 'cái 24V')).toBe(true);
    expect(p.dong[0].daChot?.id).toBe(4);
  });
  it('câu không map được → false, phiên NGUYÊN VẸN', () => {
    const p = phien();
    expect(apDungChon(p, 'tồn kho còn nhiêu?')).toBe(false);
    expect(p.khachUngVien).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Chạy fail.**
- [ ] **Step 3: Viết `chon.ts`**:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Map câu chọn của NV lên ứng viên trong phiên — CODE TRƯỚC, LLM sau (Task 5
// chỉ xử khi đây trả false). Quy ước khớp loi-nhan.ts: khách 1..n, SP a..z.
import type { PhienGom } from './kieu.js';
import { boDau } from '../../../odoo/tools/tra-san-pham.js';
import { laMaKh } from '../../../odoo/tools/tra-khach-hang.js';

const chuCai = (i: number) => String.fromCharCode(97 + i); // 0→a

export function apDungChon(p: PhienGom, cauTho: string): boolean {
  const cau = cauTho.trim();
  let map = false;

  // "1a", "2", "1 a" — số chốt khách, chữ chốt SP dòng đầu còn chờ.
  const gon = cau.toLowerCase().replace(/\s+/g, '');
  const soChu = gon.match(/^(\d{1,2})?([a-z])?$/);
  if (soChu && (soChu[1] || soChu[2])) {
    if (soChu[1] && p.khachUngVien) {
      const k = p.khachUngVien[Number(soChu[1]) - 1];
      if (k) { p.khachDaChot = k; delete p.khachUngVien; map = true; }
    }
    if (soChu[2]) {
      const dong = p.dong.find((d) => d.ungVien?.length);
      const s = dong?.ungVien?.[chuCai.length && dong.ungVien.findIndex((_, i) => chuCai(i) === soChu[2])];
      if (dong && s) { dong.daChot = { id: s.id, ten: s.ten, gia: s.gia }; delete dong.ungVien; map = true; }
    }
    if (map) return true;
  }

  // Mã KH / SĐT khớp đúng một ứng viên khách.
  if (p.khachUngVien) {
    const sdt = cau.replace(/[^\d]/g, '');
    const khop = p.khachUngVien.filter((k) =>
      (laMaKh(cau) && k.ma?.toLowerCase() === cau.toLowerCase()) ||
      (sdt.length >= 9 && k.dienThoai?.replace(/[^\d]/g, '').endsWith(sdt.slice(-9))));
    if (khop.length === 1) { p.khachDaChot = khop[0]; delete p.khachUngVien; map = true; }
  }

  // Mảnh chữ khớp DUY NHẤT một ứng viên (khách hoặc SP) — "cái 24V", "Trần Hưng".
  const manh = boDau(cau).split(/\s+/).filter((t) => t.length >= 2);
  const khopDuyNhat = <T>(ds: T[] | undefined, ten: (x: T) => string): T | null => {
    if (!ds || manh.length === 0) return null;
    const khop = ds.filter((x) => manh.some((m) => boDau(ten(x)).includes(m)));
    return khop.length === 1 ? khop[0] : null;
  };
  if (p.khachUngVien) {
    const k = khopDuyNhat(p.khachUngVien, (x) => x.ten);
    if (k) { p.khachDaChot = k; delete p.khachUngVien; map = true; }
  }
  for (const dong of p.dong) {
    const s = khopDuyNhat(dong.ungVien, (x) => x.ten);
    if (s) { dong.daChot = { id: s.id, ten: s.ten, gia: s.gia }; delete dong.ungVien; map = true; }
  }
  return map;
}
```

- [ ] **Step 4: Chạy pass** (sửa impl đến khi xanh — chú ý case chữ cái: viết thẳng `dong.ungVien.findIndex((_, i) => chuCai(i) === soChu[2])`).
- [ ] **Step 5: Commit** — `feat(nv): map câu chọn khách/SP — số, chữ, mã KH, SĐT, mảnh tên`.

---

### Task 3: Template lời nhắn

**Files:**
- Create: `src/modules/ai/agent/noi-zalo/gom-don/loi-nhan.ts`
- Test: `tests/ai/agent/gom-don/loi-nhan.test.ts`

**Interfaces:**
- Consumes: `PhienGom`, `HanhDong`.
- Produces: `renderLoiNhan(hd: HanhDong, p: PhienGom): string` — Task 6 gửi nguyên văn qua `guiTin`.

- [ ] **Step 1: Test fail** (khớp quy ước 1..n / a..z của Task 2):

```ts
import { describe, it, expect } from 'vitest';
import { renderLoiNhan } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/loi-nhan.js';
import type { PhienGom } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/kieu.js';

const p: PhienGom = {
  khachTuKhoa: 'Hưng',
  khachUngVien: [
    { id: 7, ten: 'Hưng Cty A', ma: 'KH001017', dienThoai: '0901234567', congNo: 0 },
    { id: 8, ten: 'Trần Hưng', ma: 'KH000022', dienThoai: '0987654321', congNo: 0 },
  ],
  dong: [{ tuKhoa: 'nguồn NB', sl: 10, ungVien: [
    { id: 3, ten: 'Nguồn NB 12V100W', ma: null, gia: 185000, donVi: null },
    { id: 4, ten: 'Nguồn NB 24V200W', ma: null, gia: 320000, donVi: null },
  ] }],
};

describe('renderLoiNhan', () => {
  it('hoi_chon: MỘT tin gộp khách (1..n, kèm mã+SĐT) và SP (a.., kèm giá), có hướng dẫn "1a"', () => {
    const s = renderLoiNhan({ loai: 'hoi_chon' }, p);
    expect(s).toContain('1) Hưng Cty A · KH001017 · 0901234567');
    expect(s).toContain('2) Trần Hưng · KH000022 · 0987654321');
    expect(s).toContain('a) Nguồn NB 12V100W · 185.000đ');
    expect(s).toContain('b) Nguồn NB 24V200W · 320.000đ');
    expect(s).toMatch(/vd:?\s*"?1a/i);
    expect(s).not.toContain('undefined');
  });
  it('tom_tat_cho_chot: đủ khách + dòng + SL + tổng tiền', () => {
    const p2: PhienGom = { khachTuKhoa: 'Hưng',
      khachDaChot: { id: 7, ten: 'Hưng Cty A', ma: 'KH001017', dienThoai: '0901234567' },
      dong: [{ tuKhoa: 'nguồn NB', sl: 10, daChot: { id: 3, ten: 'Nguồn NB 12V100W', gia: 185000 } }] };
    const s = renderLoiNhan({ loai: 'tom_tat_cho_chot' }, p2);
    expect(s).toContain('Hưng Cty A');
    expect(s).toContain('10 × Nguồn NB 12V100W');
    expect(s).toContain('1.850.000đ');
    expect(s).toMatch(/chốt/i);
  });
  it('hoi_thieu sl: nêu tên SP còn thiếu SL', () => {
    const p3: PhienGom = { khachTuKhoa: null, dong: [{ tuKhoa: 'nguồn NB', sl: null,
      daChot: { id: 3, ten: 'Nguồn NB 12V100W', gia: 185000 } }] };
    expect(renderLoiNhan({ loai: 'hoi_thieu', thieu: 'sl' }, p3)).toContain('Nguồn NB 12V100W');
  });
});
```

- [ ] **Step 2: Chạy fail.**
- [ ] **Step 3: Viết `loi-nhan.ts`** — format tiền kiểu `1.850.000đ` (`n.toLocaleString('vi-VN') + 'đ'`); mỗi nhánh `HanhDong` một hàm nhỏ; `khong_thay` gợi ý gõ lại tên khác; `hoi_thieu khach` = "Đơn này lên cho khách nào ạ?"; KHÔNG markdown.
- [ ] **Step 4: Chạy pass.**
- [ ] **Step 5: Commit** — `feat(nv): template lời nhắn gom đơn — danh sách chọn tất định, hết bịa`.

---

### Task 4: Bảng `phien_gom_don` + store

**Files:**
- Modify: `prisma/schema.prisma` (thêm model cuối file, cạnh ToolCallLog)
- Create: `prisma/migrations/20260807220000_phien_gom_don/migration.sql`
- Create: `src/modules/ai/agent/noi-zalo/gom-don/phien-store.ts`
- Test: `tests/ai/agent/gom-don/phien-store.test.ts`

**Interfaces:**
- Produces: `docPhien(prisma, conversationId): Promise<PhienGom | null>` (quá hạn → xoá, trả null), `luuPhien(prisma, {orgId, conversationId, phien})` (upsert, hạn = now + 15'), `xoaPhien(prisma, conversationId)`. Prisma nhận dạng `Pick<PrismaClient, 'phienGomDon'>` để test mock được.

- [ ] **Step 1: Thêm model** vào `schema.prisma`:

```prisma
/// Phiên gom đơn của máy trạng thái slot (spec 2026-08-07-luong-len-don-slot).
/// Lưu DB chứ không in-memory: restart container không rơi phiên giữa chừng.
model PhienGomDon {
  id             String   @id @default(cuid())
  orgId          String   @map("org_id")
  conversationId String   @unique @map("conversation_id")
  /// PhienGom serialize nguyên khối — cấu trúc chỉ code gom-don đọc.
  slots          Json
  /// Chạm hạn là phiên chết — tránh phiên ma dính vĩnh viễn vào hội thoại.
  hetHan         DateTime @map("het_han")
  updatedAt      DateTime @updatedAt @map("updated_at")

  @@index([hetHan])
  @@map("phien_gom_don")
}
```

- [ ] **Step 2: Sinh migration** — `npx prisma migrate dev --name phien_gom_don --create-only` rồi soát SQL; `npx prisma generate`.
- [ ] **Step 3: Test fail** — mock prisma bằng object thường:

```ts
import { describe, it, expect } from 'vitest';
import { docPhien, luuPhien } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/phien-store.js';

function fakePrisma() {
  const rows = new Map<string, { orgId: string; conversationId: string; slots: unknown; hetHan: Date }>();
  return {
    rows,
    phienGomDon: {
      findUnique: async ({ where }: any) => rows.get(where.conversationId) ?? null,
      upsert: async ({ where, create }: any) => { rows.set(where.conversationId, create); return create; },
      delete: async ({ where }: any) => { rows.delete(where.conversationId); },
      deleteMany: async ({ where }: any) => { rows.delete(where.conversationId); },
    },
  };
}

describe('phien-store', () => {
  it('lưu rồi đọc lại nguyên vẹn', async () => {
    const db = fakePrisma();
    await luuPhien(db as any, { orgId: 'o1', conversationId: 'c1',
      phien: { khachTuKhoa: 'Hưng', dong: [{ tuKhoa: 'nguồn NB', sl: 10 }] } });
    const p = await docPhien(db as any, 'c1');
    expect(p?.khachTuKhoa).toBe('Hưng');
  });
  it('quá hạn → trả null và xoá', async () => {
    const db = fakePrisma();
    db.rows.set('c1', { orgId: 'o1', conversationId: 'c1',
      slots: { khachTuKhoa: 'Hưng', dong: [] }, hetHan: new Date(Date.now() - 1000) });
    expect(await docPhien(db as any, 'c1')).toBeNull();
    expect(db.rows.has('c1')).toBe(false);
  });
});
```

- [ ] **Step 4: Chạy fail → viết `phien-store.ts`** (TTL hằng `HAN_PHIEN_PHUT = 15`; `docPhien` so `hetHan < new Date()` thì `deleteMany` + null; `luuPhien` upsert `slots: phien as unknown as Prisma.InputJsonValue`) **→ chạy pass.**
- [ ] **Step 5: Commit** — `feat(nv): bảng phien_gom_don + store TTL 15 phút`.

---

### Task 5: Trích slot bằng LLM (structured, một tool ép)

**Files:**
- Create: `src/modules/ai/agent/noi-zalo/gom-don/trich-slot.ts`
- Test: `tests/ai/agent/gom-don/trich-slot.test.ts` (fake generate)
- Test: `tests/ai/agent/gom-don/trich-slot.func.ts` (LLM thật — chạy `npx vitest run -c vitest.func.config.ts`, thêm ~12 câu thật: "10c", "lấy 5 cái", "KH001017", "thôi huỷ đi", "tồn kho NB còn nhiêu?")

**Interfaces:**
- Consumes: `ToolAwareGenerate` từ `../types.js` (qua `dungGenerate` lúc chạy thật).
- Produces: `trichSlot(generate, cau: string, phien: PhienGom | null): Promise<KetQuaTrich>` với

```ts
export interface KetQuaTrich {
  khach?: string;                       // "Hưng" — chỉ TÊN/mã, không xưng hô
  dong?: Array<{ sp: string; sl?: number }>;
  huy?: boolean;                        // "thôi", "huỷ đi"
  xacNhan?: boolean;                    // "ok", "chốt", "lên đi"
  ngoaiLe?: boolean;                    // câu KHÔNG liên quan đơn (digression)
}
```

- [ ] **Step 1: Test fail (fake generate)** — fake trả `AgentTurn` có `toolCalls: [{ id: 't1', name: 'ghi_slot', input: {...} }]`; case chính:
  - `"lên đơn cho anh Hưng 10 cái nguồn NB nhé"` + phien null → generate được gọi với `tools` đúng 1 định nghĩa `ghi_slot`, kết quả `{khach:'Hưng', dong:[{sp:'nguồn NB', sl:10}]}`.
  - model KHÔNG gọi tool (turn.text thường) → trả `{ngoaiLe: true}` (đường lui an toàn).
  - input rác (`sl: 'mười'`) → bỏ field sai kiểu, giữ field đúng.
- [ ] **Step 2: Chạy fail → viết `trich-slot.ts`**: system prompt ngắn (~15 dòng): "Bạn trích thông tin ĐƠN HÀNG từ MỘT câu của nhân viên. LUÔN gọi tool ghi_slot. Chỉ trích cái CÓ trong câu — không đoán. Bỏ xưng hô (anh/chị/em) khỏi tên khách."; kèm ngữ cảnh phiên hiện tại (đã có gì) để model hiểu "10 cái" là SL bổ sung; `ghi_slot` inputSchema đúng `KetQuaTrich`; validate từng field bằng typeof, `sl` ép `Number` nguyên dương ≤ 100000.
- [ ] **Step 3: Chạy pass unit; viết `.func.ts` chạy LLM thật khi có cấu hình dev.**
- [ ] **Step 4: Commit** — `feat(nv): trích slot LLM — một tool ép, validate kiểu ở code`.

---

### Task 6: Orchestrator `xuLyGomDon` + kịch bản replay 07/08

**Files:**
- Create: `src/modules/ai/agent/noi-zalo/gom-don/index.ts`
- Test: `tests/ai/agent/gom-don/replay-07-08.test.ts`

**Interfaces:**
- Consumes: mọi thứ Task 1-5; `traKhachHang`, `traSanPham` (`../../../odoo/tools/…`), `taoDonNhap` (`{odoo, conversationId, seq}` — KHÔNG đặt `tranTien` cho NV), `guiHoaDon` (`{odoo, anhClient, odooUrl}`), `dinhDangTaoDon`.
- Produces:

```ts
export interface GomDonDeps {
  prisma: Pick<PrismaClient, 'phienGomDon'>;
  odoo: Pick<OdooClient, 'searchRead' | 'execute'>;
  generate: ToolAwareGenerate;
  anhClient: HoaDonAnhClient | null;
  odooUrl: string;
  guiTin: (text: string) => Promise<void>;
  guiAnhHoaDon: (anh: AnhHoaDon) => Promise<void>;   // wrapper guiAnh + ghiAnhTam của caller
  ghiLog: GhiLogTool;                                 // cùng kiểu taoGhiLog trả về
}
/** true = máy đã nhận xử lý tin này; false = nhường agent thường (digression/không phải lên đơn). */
export async function xuLyGomDon(
  deps: GomDonDeps,
  input: { orgId: string; conversationId: string; seq: number; cau: string },
): Promise<boolean>;
```

- [ ] **Step 1: Viết test replay** — fake odoo (theo mẫu `tests/ai/odoo/tao-don-nhap.func.ts` đã có nhánh `res.partner`), fake generate trả kịch bản trích slot cứng theo câu vào; 2 khách tên Hưng + 2 SP "Nguồn NB". Kịch bản #1 — đúng chat 21:07 07/08:

```ts
// Lượt 1: "lên đơn cho anh Hưng 10 cái nguồn NB nhé"
//   → PHẢI: tra khách + SP song song; MỘT tin hỏi gộp 2 danh sách; KHÔNG chứa "bao nhiêu"
// Lượt 2: nhắn lại y nguyên câu lượt 1
//   → PHẢI: vẫn là danh sách chọn (phiên giữ), KHÔNG tạo phiên mới, KHÔNG hỏi SL
// Lượt 3: "1a" → tóm tắt "10 × Nguồn NB 12V100W … 1.850.000đ", hỏi chốt
// Lượt 4: "ok" → taoDonNhap được gọi ĐÚNG 1 lần với khach_hang_id=7,
//   dong=[{san_pham_id:3, so_luong:10}], ten_khach='Hưng Cty A'; guiTin có mã đơn;
//   guiAnhHoaDon được gọi khi anh có; phiên bị xoá.
// Kịch bản #2 — digression: giữa lượt 2-3 chen "tồn kho NB còn nhiêu?"
//   (fake generate trả ngoaiLe) → xuLyGomDon trả false, phiên còn nguyên.
// Kịch bản #3 — "thôi huỷ đi" → guiTin xác nhận huỷ, phiên xoá.
```

Assertion cấm-hỏi-lại viết thành helper dùng chung: `expect(tinGui.join('\n')).not.toMatch(/bao nhiêu/i)`.

- [ ] **Step 2: Chạy fail → viết `index.ts`** — khung:

```ts
const NHAN_LENH_LEN_DON = /(?:lên|len|tạo|tao|đặt|dat)\s*(?:đơn|don)|(?:đặt|dat)\s*h[àa]ng/i;

export async function xuLyGomDon(deps: GomDonDeps, input: {...}): Promise<boolean> {
  let phien = await docPhien(deps.prisma, input.conversationId);
  if (!phien && !NHAN_LENH_LEN_DON.test(input.cau)) return false;   // không phải việc của máy

  // 1. Chọn bằng code trước — rẻ và tất định; không map được mới tốn LLM.
  const daChon = phien ? apDungChon(phien, input.cau) : false;
  let trich: KetQuaTrich = {};
  if (!daChon) trich = await trichSlot(deps.generate, input.cau, phien);
  if (!phien && trich.ngoaiLe) return false;
  if (phien && trich.ngoaiLe && !daChon) return false;               // digression — phiên GIỮ NGUYÊN
  phien ??= { khachTuKhoa: null, dong: [] };
  if (trich.huy) { await xoaPhien(...); await deps.guiTin('Em huỷ đơn đang gom rồi ạ.'); return true; }
  // 2. Đắp slot mới trích vào phiên (khach → khachTuKhoa nếu chưa chốt; dong nối thêm,
  //    câu chỉ có SL ("10 cái") → điền vào dòng đầu còn thiếu sl).
  // 3. Vòng: hd = buocTiepTheo(phien); nếu 'tra_cuu' → chạy song song
  //    Promise.all([traKhachHang…, …dong.map(traSanPham)]) — đúng 1 kết quả thì tự chốt,
  //    nhiều thì ungVien, rỗng thì khongThay; ghi deps.ghiLog từng tool; lặp lại buocTiepTheo.
  // 4. 'tao_don' CHỈ khi phien.daHoiChot && (trich.xacNhan || laXacNhanNgan(input.cau)) —
  //    chưa xác nhận thì gửi lại tóm tắt. Sau da_tao: guiHoaDon → guiTin(dinhDang…) +
  //    guiAnhHoaDon + link; 'loi' → guiTin lý do; xong xoaPhien.
  // 5. Nhánh còn lại: guiTin(renderLoiNhan(hd, phien)); daHoiChot = hd.loai==='tom_tat_cho_chot';
  //    luuPhien. return true.
}
```

Viết đủ thân hàm (~150 dòng) — mọi nhánh `HanhDong` phải có code, không nhánh nào ném "chưa làm".

- [ ] **Step 3: Chạy pass cả 3 kịch bản.**
- [ ] **Step 4: Commit** — `feat(nv): máy trạng thái gom đơn + kịch bản replay bug 21:07 07/08`.

---

### Task 7: Cắm vào `xuLyTinNhanVien`

**Files:**
- Modify: `src/modules/ai/agent/noi-zalo/luong-nhan-vien.ts` (sau khi có `dich` + `generate`, TRƯỚC `layLichSu`/`chayLenhNhanVien` — quãng dòng 85-95)
- Test: `tests/ai/agent/gom-don/wiring.test.ts`

**Interfaces:**
- Consumes: `xuLyGomDon` (Task 6), `layOdoo`/`layAnhClient`/`odooUrlCongKhai`/`seqTuMessageId` từ `du-lieu.js`/`cong-tac.js`, `guiTin`/`guiAnh`/`ghiAnhTam` từ `gui-zalo.js`, `taoGhiLog`.

- [ ] **Step 1: Test fail** — mock `xuLyGomDon` (vi.mock module gom-don): khi nó trả `true` thì `chayLenhNhanVien` KHÔNG được gọi; trả `false` thì luồng cũ chạy như trước (theo mẫu mock sẵn có trong `tests/ai/agent/noi-zalo.func.ts` phần dàn cảnh).
- [ ] **Step 2: Chèn wiring**:

```ts
// MÁY GOM ĐƠN (spec 07/08) — chạy TRƯỚC agent thường: lệnh lên đơn và phiên
// đang mở thuộc về máy; nó trả false thì tin là việc khác, agent thường xử.
const ghiDbGomDon = taoGhiLog({ prisma: prismaLog, orgId: ctx.orgId, vai: 'nhanvien',
  conversationId: ctx.conversationId, onError: (err) => logger.warn({ err }, '[agent/nv] log gom-don lỗi') });
const gomDonXong = await chayCoHanGio('nv', xuLyGomDon({
  prisma, odoo: layOdoo(), generate, anhClient: layAnhClient(), odooUrl: odooUrlCongKhai(),
  guiTin: (t) => guiTin(dich, t, false),
  guiAnhHoaDon: async (anh) => guiAnh(dich, await ghiAnhTam(anh.duLieu, anh.tenFile), false),
  ghiLog: ghiDbGomDon,
}, { orgId: ctx.orgId, conversationId: ctx.conversationId,
     seq: seqTuMessageId(ctx.messageId), cau: lenh.noiDung }));
if (gomDonXong) { moc.xong(t0, { nhanh: 'gom-don', conversationId: ctx.conversationId }); return true; }
```

(`t0` phải dời lên trước đoạn này; lỗi trong `xuLyGomDon` để nhánh catch hiện có của hàm bắt — nó đã báo nhân viên khi lỗi.)

- [ ] **Step 3: Chạy pass + chạy TOÀN BỘ unit** — `npm test` (105 file cũ không được đỏ).
- [ ] **Step 4: Commit** — `feat(nv): cắm máy gom đơn vào luồng nhân viên — chạy trước agent thường`.

---

### Task 8: Chốt sổ

- [ ] **Step 1:** `npx tsc --noEmit` sạch.
- [ ] **Step 2:** `npm test` toàn bộ xanh; `npx vitest run -c vitest.func.config.ts tests/ai/agent/gom-don/` (nếu có LLM dev) xanh.
- [ ] **Step 3:** Cập nhật `docs/KIEN-TRUC-AGENT.md`: thêm nhánh gom-don vào sơ đồ "Tin nhắn đi qua đâu" + bảng file (một dòng mỗi file mới).
- [ ] **Step 4:** Commit `docs: kiến trúc thêm máy gom đơn` — KHÔNG deploy trong plan này; deploy là bước của anh Quốc (Dokploy) sau khi duyệt.

## Self-review

- Spec coverage: tra song song (T1 case 1 + T6), một tin gộp chọn (T3), không hỏi lại slot (T1 case 2 + helper cấm-hỏi-lại T6), chốt→tạo→báo giá+link cho NV (T6 bước 4), TTL (T4), digression + huỷ (T6 #2 #3), guard cũ giữ nguyên (T7 không đụng), replay = hợp đồng (T6). Đủ.
- Placeholder: không còn "TBD"; T3/T5/T6 có khung + mô tả đủ chi tiết hành vi từng nhánh.
- Type nhất quán: `PhienGom/DongGom/HanhDong/KetQuaTrich/GomDonDeps` dùng thống nhất T1→T7; quy ước 1..n/a..z khớp T2↔T3.
