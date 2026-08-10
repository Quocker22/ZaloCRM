# Tool Odoo tổng quát — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bot làm được mọi thao tác Odoo qua 3 tool tổng quát thay vì phải viết tool cho từng nghiệp vụ.

**Architecture:** Module mới `src/modules/ai/odoo/tong-quat/` — `doc.ts` (đọc), `lam.ts` (ghi + 2 phanh), `kham-pha.ts` (đọc cấu trúc Odoo), `an-toan.ts` (hàng rào dùng chung: cột cấm, đếm bản ghi, quyết định phanh). Bảng `ThaoTacOdoo` chứa việc quen. Chỉ đăng ký vào registry NHÂN VIÊN.

**Tech Stack:** TypeScript ESM (import đuôi `.js`), Prisma, vitest, OdooClient qua XML-RPC.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-10-tool-odoo-tong-quat-design.md`.
- **Hai phanh, nằm trong CODE**: (1) mọi `unlink`; (2) lệnh đụng **> 20** bản ghi. Chạm phanh → trả yêu cầu xác nhận, KHÔNG gọi Odoo.
- Ghi thông thường (`create`/`write`/gọi nút) → chạy luôn, không hỏi.
- **Cột cấm tuyệt đối**: `standard_price`, `cost`, `purchase_price`, `margin`, và mọi cột chứa `cost`/`margin` (khớp `FORBIDDEN_FIELDS` của `tra-san-pham.ts`).
- **CHỈ registry nhân viên** — `buildCustomerRegistry` tuyệt đối không có 3 tool này.
- 18 tool cũ và máy gom đơn KHÔNG đổi hành vi; suite cũ phải xanh.
- Comment tiếng Việt giải thích "vì sao", theo nếp repo. Commit `feat(nv)/fix(nv)` + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Hàng rào an toàn (`an-toan.ts`)

**Files:**
- Create: `src/modules/ai/odoo/tong-quat/an-toan.ts`
- Test: `tests/ai/odoo/tong-quat/an-toan.test.ts`

**Interfaces:**
- Produces: `NGUONG_HANG_LOAT = 20`; `locCotCam(cot: string[]): { sach: string[]; cam: string[] }`; `laCotCam(ten: string): boolean`; `type QuyetDinh = { chay: true } | { chay: false; lyDo: string; soBanGhi: number }`; `quyetDinhPhanh(input: { viec: string; nut?: string; soBanGhi: number; xacNhan?: boolean }): QuyetDinh`.

- [ ] **Step 1: Viết test**

```ts
import { describe, it, expect } from 'vitest';
import { laCotCam, locCotCam, quyetDinhPhanh, NGUONG_HANG_LOAT }
  from '../../../../src/modules/ai/odoo/tong-quat/an-toan.js';

describe('cột cấm', () => {
  it('chặn giá vốn và mọi biến thể chứa cost/margin', () => {
    expect(laCotCam('standard_price')).toBe(true);
    expect(laCotCam('margin')).toBe(true);
    expect(laCotCam('purchase_price')).toBe(true);
    expect(laCotCam('x_cost_extra')).toBe(true);
    expect(laCotCam('list_price')).toBe(false);
    expect(laCotCam('name')).toBe(false);
  });
  it('locCotCam tách sạch/cấm, giữ thứ tự', () => {
    expect(locCotCam(['name', 'standard_price', 'list_price']))
      .toEqual({ sach: ['name', 'list_price'], cam: ['standard_price'] });
  });
});

describe('phanh', () => {
  it('XOÁ luôn phải xác nhận, dù chỉ 1 bản ghi', () => {
    const kq = quyetDinhPhanh({ viec: 'goi_nut', nut: 'unlink', soBanGhi: 1 });
    expect(kq).toEqual({ chay: false, lyDo: 'xoa', soBanGhi: 1 });
  });
  it('xoá + đã xác nhận → chạy', () => {
    expect(quyetDinhPhanh({ viec: 'goi_nut', nut: 'unlink', soBanGhi: 1, xacNhan: true }))
      .toEqual({ chay: true });
  });
  it(`đụng ${NGUONG_HANG_LOAT} bản ghi → chạy; ${NGUONG_HANG_LOAT + 1} → xác nhận`, () => {
    expect(quyetDinhPhanh({ viec: 'sua', soBanGhi: NGUONG_HANG_LOAT }).chay).toBe(true);
    const nhieu = quyetDinhPhanh({ viec: 'sua', soBanGhi: NGUONG_HANG_LOAT + 1 });
    expect(nhieu).toEqual({ chay: false, lyDo: 'hang_loat', soBanGhi: 21 });
  });
  it('ghi thường 1 bản ghi → chạy luôn, không hỏi', () => {
    expect(quyetDinhPhanh({ viec: 'goi_nut', nut: 'action_confirm', soBanGhi: 1 }))
      .toEqual({ chay: true });
  });
});
```

- [ ] **Step 2: Chạy fail** — `npx vitest run tests/ai/odoo/tong-quat/an-toan.test.ts` → FAIL (module chưa có).

- [ ] **Step 3: Viết `an-toan.ts`**

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Hàng rào dùng chung cho 3 tool Odoo tổng quát.
// Spec: docs/superpowers/specs/2026-08-10-tool-odoo-tong-quat-design.md
//
// Hai phanh nằm ở ĐÂY (code), không phải prompt: bot đã từng bịa id khách
// (S13810), lặp vô tận, kẹt phiên — chỉ trong một tuần. Với quyền ghi tự do,
// những lỗi đó thành mất dữ liệu thật.

/** Lệnh đụng nhiều hơn ngần này bản ghi phải xin xác nhận (anh Quốc chốt 10/08). */
export const NGUONG_HANG_LOAT = 20;

/** Cột lộ giá vốn/biên lợi nhuận — khớp FORBIDDEN_FIELDS của tra-san-pham.ts. */
const CAM = ['standard_price', 'cost', 'purchase_price', 'margin'];

export function laCotCam(ten: string): boolean {
  const t = ten.toLowerCase();
  return CAM.includes(t) || t.includes('cost') || t.includes('margin');
}

export function locCotCam(cot: string[]): { sach: string[]; cam: string[] } {
  const sach: string[] = [];
  const cam: string[] = [];
  for (const c of cot) (laCotCam(c) ? cam : sach).push(c);
  return { sach, cam };
}

export type QuyetDinh =
  | { chay: true }
  | { chay: false; lyDo: 'xoa' | 'hang_loat'; soBanGhi: number };

export function quyetDinhPhanh(input: {
  viec: string;
  nut?: string;
  soBanGhi: number;
  xacNhan?: boolean;
}): QuyetDinh {
  if (input.xacNhan) return { chay: true };
  if (input.nut === 'unlink') return { chay: false, lyDo: 'xoa', soBanGhi: input.soBanGhi };
  if (input.soBanGhi > NGUONG_HANG_LOAT) {
    return { chay: false, lyDo: 'hang_loat', soBanGhi: input.soBanGhi };
  }
  return { chay: true };
}
```

- [ ] **Step 4: Chạy pass** — cùng lệnh trên → PASS.
- [ ] **Step 5: Commit** — `feat(nv): hàng rào an toàn cho tool Odoo tổng quát`.

---

### Task 2: `doc_odoo` — đọc bất cứ gì

**Files:**
- Create: `src/modules/ai/odoo/tong-quat/doc.ts`
- Test: `tests/ai/odoo/tong-quat/doc.test.ts`

**Interfaces:**
- Consumes: `locCotCam` (Task 1); `OdooClient` từ `../client.js`.
- Produces: `docOdoo(deps: { odoo: Pick<OdooClient,'searchRead'|'execute'> }, input: { bang: string; loc?: unknown[]; cot?: string[]; nhom_theo?: string[]; do?: string[]; sap_xep?: string; gioi_han?: number }): Promise<KetQuaDoc>`; `type KetQuaDoc = { trangThai: 'ok'; dong: Array<Record<string, unknown>>; soDong: number } | { trangThai: 'loi'; lyDo: string }`; `docOdooDefinition: ToolDefinition`; `dinhDangDoc(kq: KetQuaDoc): string`.

- [ ] **Step 1: Viết test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { docOdoo, docOdooDefinition, dinhDangDoc }
  from '../../../../src/modules/ai/odoo/tong-quat/doc.js';

const fake = (rows: unknown[] = []) => ({
  searchRead: vi.fn(async () => rows),
  execute: vi.fn(async () => rows),
});

describe('docOdoo', () => {
  it('đọc thường → search_read với cột đã lọc', async () => {
    const odoo = fake([{ id: 1, name: 'SP A' }]);
    const kq = await docOdoo({ odoo } as never,
      { bang: 'product.product', cot: ['id', 'name'], gioi_han: 5 });
    expect(kq).toEqual({ trangThai: 'ok', dong: [{ id: 1, name: 'SP A' }], soDong: 1 });
    expect(odoo.searchRead).toHaveBeenCalled();
  });

  it('xin cột CẤM → lỗi rõ ràng, KHÔNG gọi Odoo', async () => {
    const odoo = fake();
    const kq = await docOdoo({ odoo } as never,
      { bang: 'product.product', cot: ['name', 'standard_price'] });
    expect(kq.trangThai).toBe('loi');
    if (kq.trangThai === 'loi') expect(kq.lyDo).toContain('standard_price');
    expect(odoo.searchRead).not.toHaveBeenCalled();
  });

  it('có nhom_theo → dùng read_group (báo cáo gộp)', async () => {
    const odoo = fake([{ product_id: [1, 'SP A'], price_total: 39035000 }]);
    const kq = await docOdoo({ odoo } as never, {
      bang: 'sale.report', nhom_theo: ['product_id'], do: ['price_total'],
      loc: [['partner_id', '=', 76]],
    });
    expect(kq.trangThai).toBe('ok');
    const [model, method] = odoo.execute.mock.calls[0];
    expect(model).toBe('sale.report');
    expect(method).toBe('read_group');
  });

  it('thiếu bảng → lỗi, không gọi Odoo', async () => {
    const odoo = fake();
    expect((await docOdoo({ odoo } as never, { bang: '' })).trangThai).toBe('loi');
    expect(odoo.searchRead).not.toHaveBeenCalled();
  });

  it('mô tả tool nêu rõ dùng khi nào', () => {
    expect(docOdooDefinition.name).toBe('doc_odoo');
    expect(docOdooDefinition.description).toContain('doanh số');
  });

  it('dinhDangDoc: rỗng nói rõ "không có dữ liệu", không nói "lỗi"', () => {
    const s = dinhDangDoc({ trangThai: 'ok', dong: [], soDong: 0 });
    expect(s.toLowerCase()).toContain('không có dữ liệu');
  });
});
```

- [ ] **Step 2: Chạy fail.**
- [ ] **Step 3: Viết `doc.ts`** — quy tắc:
  - `bang` rỗng → `{trangThai:'loi'}` ngay, không gọi Odoo.
  - `locCotCam(cot ?? [])` và `locCotCam(do ?? [])`; có cột cấm → lỗi nêu tên cột, KHÔNG gọi Odoo.
  - Có `nhom_theo` → `odoo.execute(bang, 'read_group', [loc ?? [], [...do, ...nhom_theo], nhom_theo], { lazy: false, limit })`; ngược lại `odoo.searchRead(bang, loc ?? [], cot ?? ['id','display_name'], { limit: gioi_han ?? 50, ...(sap_xep ? {order: sap_xep} : {}) })`.
  - Trần `gioi_han`: mặc định 50, tối đa 200 (tránh nhét cả nghìn dòng vào ngữ cảnh LLM).
  - Odoo ném → `{trangThai:'loi', lyDo: <message>}`, không nuốt im.
  - `dinhDangDoc`: rỗng → "Không có dữ liệu cho truy vấn này (kỳ/điều kiện có thể không có phát sinh)."; có dữ liệu → bảng text gọn, cắt 30 dòng và ghi rõ "còn N dòng nữa".
- [ ] **Step 4: Chạy pass.**
- [ ] **Step 5: Commit** — `feat(nv): tool doc_odoo — đọc mọi báo cáo không cần khai trước`.

---

### Task 3: `lam_odoo` — ghi có phanh

**Files:**
- Create: `src/modules/ai/odoo/tong-quat/lam.ts`
- Test: `tests/ai/odoo/tong-quat/lam.test.ts`

**Interfaces:**
- Consumes: `quyetDinhPhanh`, `NGUONG_HANG_LOAT` (Task 1).
- Produces: `lamOdoo(deps, input): Promise<KetQuaLam>` với `input: { bang: string; viec: 'tao'|'sua'|'goi_nut'; du_lieu?: Record<string, unknown>; loc?: unknown[]; nut?: string; xac_nhan?: boolean }`; `type KetQuaLam = { trangThai: 'da_lam'; soBanGhi: number; ketQua: unknown } | { trangThai: 'can_xac_nhan'; lyDo: 'xoa'|'hang_loat'; soBanGhi: number; moTa: string } | { trangThai: 'loi'; lyDo: string }`; `lamOdooDefinition`; `dinhDangLam(kq)`.

- [ ] **Step 1: Viết test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { lamOdoo, dinhDangLam } from '../../../../src/modules/ai/odoo/tong-quat/lam.js';

function fake(soKhop = 1) {
  const searchRead = vi.fn(async () => Array.from({ length: soKhop }, (_, i) => ({ id: i + 1 })));
  const execute = vi.fn(async (_m: string, method: string) =>
    method === 'search_count' ? soKhop : true);
  return { searchRead, execute };
}

describe('lamOdoo — ghi thường', () => {
  it('gọi nút xác nhận đơn → chạy LUÔN, không hỏi', async () => {
    const odoo = fake(1);
    const kq = await lamOdoo({ odoo } as never,
      { bang: 'sale.order', viec: 'goi_nut', nut: 'action_confirm', loc: [['name','=','S13823']] });
    expect(kq.trangThai).toBe('da_lam');
    expect(odoo.execute.mock.calls.some((c) => c[1] === 'action_confirm')).toBe(true);
  });

  it('tạo bản ghi mới → create', async () => {
    const odoo = fake(0);
    const kq = await lamOdoo({ odoo } as never,
      { bang: 'res.partner', viec: 'tao', du_lieu: { name: 'Khách X' } });
    expect(kq.trangThai).toBe('da_lam');
    expect(odoo.execute.mock.calls.some((c) => c[1] === 'create')).toBe(true);
  });
});

describe('lamOdoo — PHANH', () => {
  it('unlink → can_xac_nhan, TUYỆT ĐỐI không gọi Odoo ghi', async () => {
    const odoo = fake(47);
    const kq = await lamOdoo({ odoo } as never,
      { bang: 'sale.order', viec: 'goi_nut', nut: 'unlink', loc: [['state','=','draft']] });
    expect(kq.trangThai).toBe('can_xac_nhan');
    if (kq.trangThai === 'can_xac_nhan') {
      expect(kq.lyDo).toBe('xoa');
      expect(kq.soBanGhi).toBe(47);
      expect(kq.moTa).toContain('47');
    }
    expect(odoo.execute.mock.calls.some((c) => c[1] === 'unlink')).toBe(false);
  });

  it('sửa 21 bản ghi → can_xac_nhan hang_loat; 20 → chạy', async () => {
    const nhieu = fake(21);
    const kq1 = await lamOdoo({ odoo: nhieu } as never,
      { bang: 'product.product', viec: 'sua', loc: [['id','>',0]], du_lieu: { list_price: 1 } });
    expect(kq1.trangThai).toBe('can_xac_nhan');
    expect(nhieu.execute.mock.calls.some((c) => c[1] === 'write')).toBe(false);

    const vua = fake(20);
    const kq2 = await lamOdoo({ odoo: vua } as never,
      { bang: 'product.product', viec: 'sua', loc: [['id','>',0]], du_lieu: { list_price: 1 } });
    expect(kq2.trangThai).toBe('da_lam');
  });

  it('xác nhận rồi → chạy thật', async () => {
    const odoo = fake(47);
    const kq = await lamOdoo({ odoo } as never, {
      bang: 'sale.order', viec: 'goi_nut', nut: 'unlink',
      loc: [['state','=','draft']], xac_nhan: true,
    });
    expect(kq.trangThai).toBe('da_lam');
    expect(odoo.execute.mock.calls.some((c) => c[1] === 'unlink')).toBe(true);
  });

  it('sửa/gọi nút mà KHÔNG có loc → lỗi (chống đụng cả bảng)', async () => {
    const odoo = fake(999);
    const kq = await lamOdoo({ odoo } as never, { bang: 'sale.order', viec: 'sua', du_lieu: { note: 'x' } });
    expect(kq.trangThai).toBe('loi');
    expect(odoo.execute).not.toHaveBeenCalled();
  });

  it('dinhDangLam nêu rõ số bản ghi khi xin xác nhận', () => {
    const s = dinhDangLam({ trangThai: 'can_xac_nhan', lyDo: 'xoa', soBanGhi: 47, moTa: 'sẽ xoá 47 đơn nháp' });
    expect(s).toContain('47');
    expect(s.toLowerCase()).toContain('xác nhận');
  });
});
```

- [ ] **Step 2: Chạy fail.**
- [ ] **Step 3: Viết `lam.ts`** — quy tắc:
  - `viec: 'tao'` → cần `du_lieu`; gọi `execute(bang, 'create', [du_lieu])`; `soBanGhi = 1`.
  - `viec: 'sua' | 'goi_nut'` → **bắt buộc `loc`** (thiếu → lỗi "phải nêu rõ sửa/gọi trên bản ghi nào"), đếm trước bằng `execute(bang, 'search_count', [loc])`.
  - `quyetDinhPhanh({viec, nut, soBanGhi, xacNhan: input.xac_nhan})` → `chay:false` thì trả `can_xac_nhan` kèm `moTa` bằng tiếng Việt ("sẽ xoá 47 bản ghi trên sale.order — anh/chị xác nhận giúp em").
  - Chạy: `sua` → lấy id bằng `searchRead(bang, loc, ['id'])` rồi `execute(bang,'write',[ids, du_lieu])`; `goi_nut` → `execute(bang, nut, [ids])`.
  - Odoo ném "cannot marshal None" → NUỐT (đã học từ `xuat-hoa-don.ts`: action chạy xong nhưng trả None), lỗi khác → `{trangThai:'loi'}`.
- [ ] **Step 4: Chạy pass.**
- [ ] **Step 5: Commit** — `feat(nv): tool lam_odoo — ghi tự do có phanh xoá/hàng loạt`.

---

### Task 4: `kham_pha_odoo` + bảng `ThaoTacOdoo`

**Files:**
- Create: `src/modules/ai/odoo/tong-quat/kham-pha.ts`
- Modify: `prisma/schema.prisma` (thêm model cuối file)
- Create: `prisma/migrations/20260810190000_thao_tac_odoo/migration.sql`
- Create: `prisma/seeds/thao-tac-odoo.sql`
- Test: `tests/ai/odoo/tong-quat/kham-pha.test.ts`

**Interfaces:**
- Produces: `khamPhaOdoo(deps, input: { bang?: string; hoi: 'cot'|'nut'|'tim_bang'; tu_khoa?: string }): Promise<KetQuaKhamPha>`; `khamPhaOdooDefinition`; `dinhDangKhamPha(kq)`.

- [ ] **Step 1: Thêm model Prisma**

```prisma
/// Thao tác Odoo đã khai sẵn — tầng "việc quen" của tool tổng quát.
/// Thêm việc mới = INSERT một dòng, KHÔNG sửa code, không deploy.
/// Spec: docs/superpowers/specs/2026-08-10-tool-odoo-tong-quat-design.md
model ThaoTacOdoo {
  id      String  @id @default(cuid())
  orgId   String  @map("org_id")
  /// Tên việc theo cách nhân viên nói: "xác nhận đơn", "thu tiền".
  ten     String
  /// Mô tả + ví dụ câu nói — vào prompt để model biết khi nào dùng.
  moTa    String  @map("mo_ta") @db.Text
  bang    String
  /// 'tao' | 'sua' | 'goi_nut'
  viec    String
  /// Method Odoo khi viec='goi_nut' (action_confirm, action_post…).
  nut     String?
  enabled Boolean @default(true)
  /// Vì sao có việc này — link yêu cầu/bug. Bắt buộc ghi khi thêm.
  ghiChu  String? @map("ghi_chu") @db.Text

  @@unique([orgId, ten])
  @@index([orgId, enabled])
  @@map("thao_tac_odoo")
}
```

- [ ] **Step 2: Viết migration tay** `prisma/migrations/20260810190000_thao_tac_odoo/migration.sql` với `CREATE TABLE IF NOT EXISTS "thao_tac_odoo" (...)` + `CREATE UNIQUE INDEX IF NOT EXISTS "thao_tac_odoo_org_id_ten_key"` + `CREATE INDEX IF NOT EXISTS "thao_tac_odoo_org_id_enabled_idx"`. Thêm policy RLS vào `prisma/rls/tenant-rls.sql` theo mẫu `ai_guidelines`. Chạy `npx prisma generate`.

- [ ] **Step 3: Viết seed** `prisma/seeds/thao-tac-odoo.sql` — 10 việc anh Quốc nêu:

| ten | bang | viec | nut |
|---|---|---|---|
| xác nhận đơn | sale.order | goi_nut | action_confirm |
| huỷ đơn | sale.order | goi_nut | action_cancel |
| xác nhận hoá đơn (vào sổ) | account.move | goi_nut | action_post |
| xác nhận phiếu kho | stock.picking | goi_nut | button_validate |
| sửa giá bán SP | product.template | sua | — |
| sửa thông tin khách | res.partner | sua | — |
| sửa chiết khấu dòng đơn | sale.order.line | sua | — |
| sửa số lượng dòng đơn | sale.order.line | sua | — |
| tạo khách mới | res.partner | tao | — |
| ghi nhận thanh toán | account.payment | tao | — |

- [ ] **Step 4: Viết test `kham-pha.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { khamPhaOdoo, dinhDangKhamPha }
  from '../../../../src/modules/ai/odoo/tong-quat/kham-pha.js';

const fake = (rows: unknown[]) => ({ searchRead: vi.fn(async () => rows), execute: vi.fn(async () => rows) });

describe('khamPhaOdoo', () => {
  it('hỏi cột → đọc ir.model.fields, BỎ cột cấm khỏi kết quả', async () => {
    const odoo = fake([
      { name: 'list_price', field_description: 'Giá bán', ttype: 'float' },
      { name: 'standard_price', field_description: 'Giá vốn', ttype: 'float' },
    ]);
    const kq = await khamPhaOdoo({ odoo } as never, { bang: 'product.product', hoi: 'cot' });
    const text = dinhDangKhamPha(kq);
    expect(text).toContain('list_price');
    expect(text).not.toContain('standard_price');
  });

  it('tìm bảng theo từ khoá', async () => {
    const odoo = fake([{ model: 'stock.picking', name: 'Transfer' }]);
    const kq = await khamPhaOdoo({ odoo } as never, { hoi: 'tim_bang', tu_khoa: 'kho' });
    expect(dinhDangKhamPha(kq)).toContain('stock.picking');
  });

  it('hỏi cột mà thiếu bảng → lỗi', async () => {
    const odoo = fake([]);
    const kq = await khamPhaOdoo({ odoo } as never, { hoi: 'cot' });
    expect(kq.trangThai).toBe('loi');
  });
});
```

- [ ] **Step 5: Chạy fail → viết `kham-pha.ts`**: `hoi:'cot'` → `searchRead('ir.model.fields', [['model','=',bang]], ['name','field_description','ttype'], {limit:200})` rồi lọc `laCotCam`; `hoi:'nut'` → `searchRead('ir.model.fields'…)` không đủ, dùng `execute(bang, 'fields_get', [], {attributes:['string','type']})` cho cột và trả danh sách method phổ biến đã biết (`action_confirm`, `action_cancel`, `action_post`, `button_validate`, `unlink`) kèm ghi chú "còn method khác, cứ thử"; `hoi:'tim_bang'` → `searchRead('ir.model', [['name','ilike',tu_khoa]], ['model','name'], {limit:20})`. **→ chạy pass.**
- [ ] **Step 6: Commit** — `feat(nv): kham_pha_odoo + bảng thao_tac_odoo`.

---

### Task 5: Đăng ký vào registry NHÂN VIÊN + prompt

**Files:**
- Modify: `src/modules/ai/agent/staff-agent.ts` (import + `buildStaffRegistry`)
- Modify: `src/modules/ai/agent/staff-command.ts` (prompt: 2 dòng)
- Test: `tests/ai/odoo/tong-quat/ranh-gioi.test.ts`

**Interfaces:**
- Consumes: 3 tool + `dinhDang*` từ Task 2-4.
- Produces: `buildStaffRegistry` có thêm `doc_odoo`, `lam_odoo`, `kham_pha_odoo`; `StaffAgentDeps` thêm `thaoTacQuen?: Array<{ ten: string; moTa: string; bang: string; viec: string; nut?: string | null }>`.

- [ ] **Step 1: Viết test ranh giới**

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildStaffRegistry } from '../../../../src/modules/ai/agent/staff-agent.js';
import { buildCustomerRegistry } from '../../../../src/modules/ai/agent/customer-agent.js';
import type { OdooClient } from '../../../../src/modules/ai/odoo/client.js';

const odoo = { searchRead: vi.fn(async () => []), execute: vi.fn(async () => 1) } as unknown as OdooClient;

describe('ranh giới 3 tool tổng quát', () => {
  it('registry NHÂN VIÊN có đủ 3 tool', () => {
    const r = buildStaffRegistry({ odoo, conversationId: 'c', seq: 0, ghiNhanChuyenSale: async () => {} });
    const ten = r.definitions().map((d) => d.name);
    expect(ten).toContain('doc_odoo');
    expect(ten).toContain('lam_odoo');
    expect(ten).toContain('kham_pha_odoo');
  });

  it('registry KHÁCH TUYỆT ĐỐI không có — khách điều khiển được câu chữ', () => {
    const r = buildCustomerRegistry({ odoo, ghiNhanChuyenSale: async () => {} });
    const ten = r.definitions().map((d) => d.name);
    expect(ten).not.toContain('doc_odoo');
    expect(ten).not.toContain('lam_odoo');
    expect(ten).not.toContain('kham_pha_odoo');
  });
});
```

- [ ] **Step 2: Chạy fail → đăng ký 3 tool trong `buildStaffRegistry`** (đặt sau khối `xuat_hoa_don`), mỗi tool `run` gọi hàm tương ứng rồi `dinhDang*`; `lam_odoo` ghi log qua `deps.ghiLog` như các tool ghi khác.
- [ ] **Step 3: Thêm 2 dòng vào `buildStaffSystemPrompt`** (nén tối đa, nới trần test 2900→3050):

```
'Việc Odoo chưa có tool riêng → `doc_odoo` (mọi báo cáo/tra cứu), `lam_odoo`',
'(xác nhận đơn, kho, thanh toán…). Không rõ bảng/nút → `kham_pha_odoo` trước.',
```

- [ ] **Step 4: Chạy pass + `npm test` toàn bộ** (sửa trần prompt trong `tests/ai/agent/staff-command.test.ts` nếu đỏ).
- [ ] **Step 5: Commit** — `feat(nv): đăng ký 3 tool Odoo tổng quát cho luồng nhân viên`.

---

### Task 6: Nạp việc quen vào prompt + chốt sổ

**Files:**
- Modify: `src/modules/ai/agent/noi-zalo/du-lieu.ts` (thêm `layThaoTacQuen`)
- Modify: `src/modules/ai/agent/noi-zalo/luong-nhan-vien.ts` (truyền vào deps)
- Modify: `backend/docs/KIEN-TRUC-AGENT.md`
- Test: `tests/ai/odoo/tong-quat/thao-tac-quen.test.ts`

- [ ] **Step 1: Viết test**: `layThaoTacQuen(prismaGia, orgId)` trả mảng đã lọc `enabled`, sắp theo `ten`; lỗi DB → trả `[]` (không được làm chết lượt).
- [ ] **Step 2: Viết `layThaoTacQuen`** trong `du-lieu.ts` theo mẫu `timTriThuc` (nuốt lỗi, log warn).
- [ ] **Step 3: Truyền vào `chayLenhNhanVien` qua `thaoTacQuen`; trong `staff-agent.ts` ghép vào phần mô tả tool `lam_odoo`** (dòng ngắn: `ten → bang.nut`), tối đa 20 việc để prompt không phình.
- [ ] **Step 4: `npx tsc --noEmit` + `npm test` + `npx vitest run -c vitest.func.config.ts` — tất cả xanh.**
- [ ] **Step 5: Cập nhật `docs/KIEN-TRUC-AGENT.md`**: thêm mục "Tool Odoo tổng quát" với bảng 3 file + 2 phanh + ghi rõ "chỉ registry nhân viên".
- [ ] **Step 6: Commit + push.** Deploy: tạo bảng `thao_tac_odoo` trên prod TRƯỚC (SQL `IF NOT EXISTS`), rồi push để Dokploy build, xong `npx prisma migrate deploy` ghi sổ, rồi chạy seed.

## Self-review

- **Spec coverage**: `doc_odoo` (T2), `lam_odoo` + 2 phanh (T1, T3), `kham_pha_odoo` (T4), bảng việc quen (T4 schema + T6 nạp prompt), chặn cột cấm (T1 dùng ở T2, T4), chỉ registry nhân viên (T5), nhật ký (T5 ghiLog), test 7 nhóm (rải T1-T5). Đủ.
- **Placeholder**: không còn "TBD"; mọi bước có mã hoặc quy tắc cụ thể.
- **Type nhất quán**: `QuyetDinh`/`KetQuaDoc`/`KetQuaLam`/`KetQuaKhamPha` dùng thống nhất; `NGUONG_HANG_LOAT` một nguồn duy nhất ở `an-toan.ts`.
