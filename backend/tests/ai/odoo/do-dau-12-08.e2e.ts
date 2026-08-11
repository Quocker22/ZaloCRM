// SPDX-License-Identifier: AGPL-3.0-or-later
// ĐO THẬT trên Odoo — kiểm chứng bản sửa "TÔN TRỌNG DẤU" (ca 01:12 ngày 12/08).
//
// CHỈ ĐỌC: không tạo, không sửa, không xoá gì. An toàn chạy trên DB thật.
//
// Chạy (vitest KHÔNG nhận --env-file, phải tự nạp .env vào shell):
//   set -a; . ./.env; set +a; \
//     npx vitest run -c vitest.e2e.config.ts tests/ai/odoo/do-dau-12-08.e2e.ts
// (cần ODOO_URL/ODOO_DB/ODOO_USERNAME/ODOO_PASSWORD; thiếu thì tự SKIP)
//
// Sáu ca bắt buộc, đúng những gì anh Quốc yêu cầu kiểm chứng:
//   1. "Vấn"       (có dấu)   -> ĐÚNG 1 người "Anh Vấn Đà Nẵng", KHÔNG Văn/Vạn/Vân
//   2. "van"       (không dấu)-> vẫn ra được "Anh Vấn Đà Nẵng"
//   3. "thuc"                 -> ra "Anh Thức ..."
//   4. "nguon NB"             -> ra sản phẩm Nguồn NB
//   5. "trung quoc"           -> ra NCC Trung Quốc
//   6. "a Long led"           -> vẫn tự chốt "Anh Long Led" (chống hồi quy ee73bf3d)
import { describe, it, expect, beforeAll } from 'vitest';
import { OdooClient } from '../../../src/modules/ai/odoo/client.js';
import { traKhachHang } from '../../../src/modules/ai/odoo/tools/tra-khach-hang.js';
import { traSanPham } from '../../../src/modules/ai/odoo/tools/tra-san-pham.js';
import { traNhaCungCap } from '../../../src/modules/ai/odoo/tools/tao-don-mua.js';
import { mauKhongDau, boDau, bienTheDau } from '../../../src/modules/ai/odoo/tim-khong-dau.js';

const { ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD } = process.env;
const coDuCauHinh = Boolean(ODOO_URL && ODOO_DB && ODOO_USERNAME && ODOO_PASSWORD);

const odoo = coDuCauHinh
  ? new OdooClient({ url: ODOO_URL!, db: ODOO_DB!, username: ODOO_USERNAME!, password: ODOO_PASSWORD! })
  : (null as unknown as OdooClient);

/** In ra để dán vào báo cáo — số đo mới là bằng chứng, không phải lời hứa. */
function in_(nhan: string, dong: string[]) {
  console.log(`\n### ${nhan}\n${dong.map((d) => `   ${d}`).join('\n')}`);
}

describe.skipIf(!coDuCauHinh)('ĐO THẬT — tôn trọng dấu (ca 01:12 12/08)', () => {
  beforeAll(async () => { await odoo.authenticate(); });

  it('SỰ THẬT NỀN: Odoo có ĐÚNG 1 khách tên chứa "Vấn"', async () => {
    const rows = await odoo.searchRead<Record<string, unknown>>(
      'res.partner',
      [['customer_rank', '>', 0], ['name', 'ilike', 'Vấn']],
      ['id', 'name', 'ref', 'phone'],
      { limit: 50 },
    );
    in_(`ilike 'Vấn' nguyên văn -> ${rows.length} kq`, rows.map((r) => `${r.name} [${r.ref}] ${r.phone ?? ''}`));
    expect(rows.length).toBeGreaterThan(0);
  });

  it('CA 1 — "Vấn" (có dấu) ra đúng anh Vấn, KHÔNG kèm Văn/Vạn/Vân', async () => {
    const kq = await traKhachHang({ odoo }, { ten: 'Vấn' });
    const ten = kq.trangThai === 'tim_thay' ? [kq.khach.ten]
      : kq.trangThai === 'nhieu_ket_qua' ? kq.danhSach.map((k) => k.ten) : [];
    in_(`KHÁCH "Vấn"  mẫu=${JSON.stringify(mauKhongDau('Vấn'))}  -> ${kq.trangThai} (${ten.length})`, ten);

    // MỌI tên trả về phải thật sự chứa "vấn" ĐÚNG DẤU — đây là điều đã hỏng.
    expect(ten.length).toBeGreaterThan(0);
    for (const t of ten) expect(t.toLowerCase()).toContain('vấn');
  });

  it('CA 2 — "van" (không dấu): anh Vấn phải LỌT VÀO 10 dòng hiển thị', async () => {
    // Đo prod vòng 1 hỏng đúng ở đây: 10 kq + cờ còn-nữa nhưng TOÀN Văn/Vạn/Vân,
    // anh Vấn nằm ngoài trang đầu. Cờ báo đúng nhưng người cần vẫn không thấy.
    // Vá bằng: xếp hạng TRƯỚC khi cắt, rồi TRẢI ĐỀU mỗi biến thể dấu một suất.
    const kq = await traKhachHang({ odoo }, { ten: 'van' });
    const ten = kq.trangThai === 'tim_thay' ? [kq.khach.ten]
      : kq.trangThai === 'nhieu_ket_qua' ? kq.danhSach.map((k) => k.ten) : [];
    const bt = bienTheDau('van');
    in_(`KHÁCH "van"  ${bt.length} biến thể (${bt.slice(0, 6).join(', ')}…)  -> ${kq.trangThai} (${ten.length})`, ten);

    // Mọi dòng trả về phải là biến thể dấu THẬT của "van" — không "Vinh"/"Vốn".
    for (const t of ten) expect(boDau(t)).toContain('van');
    // TIÊU CHÍ CA 2: "Anh Vấn Đà Nẵng" phải nằm trong danh sách hiện ra.
    expect(ten.some((t) => t.toLowerCase().includes('vấn'))).toBe(true);
  });

  it('CA 3 — "thuc" ra Anh Thức', async () => {
    const kq = await traKhachHang({ odoo }, { ten: 'thuc' });
    const ten = kq.trangThai === 'tim_thay' ? [kq.khach.ten]
      : kq.trangThai === 'nhieu_ket_qua' ? kq.danhSach.map((k) => k.ten) : [];
    in_(`KHÁCH "thuc"  mẫu=${JSON.stringify(mauKhongDau('thuc'))}  -> ${kq.trangThai} (${ten.length})`, ten);

    expect(ten.length).toBeGreaterThan(0);
    for (const t of ten) expect(boDau(t)).toContain('thuc');
  });

  it('CA 4 — "nguon NB" ra sản phẩm Nguồn NB', async () => {
    const ds = await traSanPham({ odoo }, { ten: 'nguon NB', gioi_han: 5 });
    const ten = ds.map((s) => s.ten);
    in_(`SP "nguon NB"  mẫu=${JSON.stringify(mauKhongDau('nguon NB'))}  -> ${ds.length} kq`, ten);

    expect(ds.length).toBeGreaterThan(0);
    for (const t of ten) expect(boDau(t)).toContain('nguon');
  });

  it('CA 5 — "trung quoc" ra NCC Trung Quốc', async () => {
    const kq = await traNhaCungCap({ odoo }, { ten: 'trung quoc' });
    const ten = kq.trangThai === 'tim_thay' ? [kq.ncc.ten]
      : kq.trangThai === 'nhieu_ket_qua' ? kq.danhSach.map((n) => n.ten) : [];
    in_(`NCC "trung quoc"  mẫu=${JSON.stringify(mauKhongDau('trung quoc'))}  -> ${kq.trangThai} (${ten.length})`, ten);

    expect(ten.length).toBeGreaterThan(0);
    for (const t of ten) expect(boDau(t)).toContain('trung quoc');
  });

  it('CA 6 — "a Long led" VẪN tự chốt Anh Long Led (chống hồi quy ee73bf3d)', async () => {
    const kq = await traKhachHang({ odoo }, { ten: 'a Long led' });
    const mo = kq.trangThai === 'tim_thay' ? `tim_thay: ${kq.khach.ten}`
      : kq.trangThai === 'nhieu_ket_qua'
        ? `${kq.danhSach.length} kq | tuChot=${kq.tuChot?.ten ?? 'KHÔNG'}\n   ${kq.danhSach.map((k) => k.ten).join('\n   ')}`
        : 'khong_thay';
    in_(`KHÁCH "a Long led"  mẫu=${JSON.stringify(mauKhongDau('a Long led'))}`, [mo]);

    // Phải chốt được đúng "Anh Long Led" — hoặc ra 1 người, hoặc nhả tuChot.
    const chot = kq.trangThai === 'tim_thay' ? kq.khach.ten
      : kq.trangThai === 'nhieu_ket_qua' ? kq.tuChot?.ten ?? '' : '';
    expect(boDau(chot)).toContain('long led');
  });
});
