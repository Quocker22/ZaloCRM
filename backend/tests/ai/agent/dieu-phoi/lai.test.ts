// SPDX-License-Identifier: AGPL-3.0-or-later
// CẦM LÁI luồng NV — model hiểu ý, code chỉ kiểm dữ liệu + ghi Odoo + render.
// Assert vào TRẠNG THÁI phiên, tin gửi, và OBJECT gọi Odoo — không so chữ điều kiện.
import { describe, it, expect, vi } from 'vitest';
import { laiLuotNhanVien, doiChieuBangChung, duDeGhi, soanCauHoi, type DepsLai } from '../../../../src/modules/ai/agent/dieu-phoi/lai.js';
import { phienTrong, type PhienDon } from '../../../../src/modules/ai/agent/dieu-phoi/phien-don.js';
import type { AgentTurn, ToolAwareGenerate } from '../../../../src/modules/ai/agent/types.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
const goiTool = (name: string, input: Record<string, unknown>, id = 't1'): AgentTurn =>
  ({ text: '', stopReason: 'tool_use', raw: [], usage, toolCalls: [{ id, name, input }] });
const goiNhieu = (calls: Array<[string, Record<string, unknown>]>): AgentTurn =>
  ({ text: '', stopReason: 'tool_use', raw: [], usage, toolCalls: calls.map(([name, input], i) => ({ id: `t${i}`, name, input })) });

/** Model giả: một hàng đợi các lượt trả về, theo thứ tự generate được gọi. */
function modelGia(luot: AgentTurn[]): ToolAwareGenerate & { goi: Array<Parameters<ToolAwareGenerate>[0]> } {
  const goi: Array<Parameters<ToolAwareGenerate>[0]> = [];
  const g = (async (a: Parameters<ToolAwareGenerate>[0]) => { goi.push(a); return luot.shift() ?? goiTool('cap_nhat_phien', { y_dinh: 'hoi_khac', che: 'khong' }); }) as ToolAwareGenerate & { goi: typeof goi };
  g.goi = goi;
  return g;
}

const KHACH_QUYET = Array.from({ length: 10 }, (_, i) => ({ id: 100 + i, ten: i === 2 ? 'Anh Quyết Nelia' : `Anh Quyết ${i}`, ma: `KH00${i}`, sdt: null }));
const SP_PHA = [{ id: 501, ten: 'Đèn Pha 100W Trắng (cái)', gia: 0, donVi: 'cái' }];
const SP_F30 = [
  { id: 701, ten: 'F30 full 26803 Đục 12V - ATX (bóng)', gia: 6300, donVi: 'bóng' },
  { id: 702, ten: 'F30 Full 26803 Trong 12V - ATX (bóng)', gia: 5200, donVi: 'bóng' },
];

function dungDeps(generate: ToolAwareGenerate, tim: DepsLai['tim']) {
  const kho = new Map<string, PhienDon>();
  const tin: string[] = [];
  const taoDon = vi.fn(async (_d: unknown, input: { khach_hang_id: number; dong: unknown[] }) => ({ trangThai: 'da_tao' as const, donId: 990001, maDon: 'S99001', khoa: 'k', tongTien: input.dong.length * 1000 }));
  const suaDon = vi.fn(async () => ({ ok: true, donId: 990001, maDon: 'S99001', tongSau: 156000 }));
  const taoKhach = vi.fn(async (i: { ten: string }) => ({ trangThai: 'ok' as const, khach: { id: 999, ten: i.ten, ma: 'KH999', daCo: false } }));
  const deps: DepsLai = {
    odoo: { searchRead: async () => [], execute: async () => 0 } as never,
    generate, anhClient: null, odooUrl: 'https://odoo.example.com',
    guiTin: async (t) => { tin.push(t); }, guiAnhHoaDon: async () => {}, ghiLog: () => {},
    docPhien: async (id) => kho.get(id) ?? phienTrong('nhanvien'),
    luuPhien: async (id, p) => { kho.set(id, p); }, xoaPhien: async (id) => { kho.delete(id); },
    tim, ghi: { taoDon, suaDon, taoKhach, dongDon: async () => [702] }, kiemSo: false,
  };
  return { deps, kho, tin, taoDon, suaDon, taoKhach };
}

const timGia = (khach: typeof KHACH_QUYET, sp: Record<string, typeof SP_PHA>): DepsLai['tim'] => ({
  khach: async () => (khach.length === 1 ? { ketQua: 'mot', khach, conNua: false } : khach.length === 0 ? { ketQua: 'khong', khach: [], conNua: false } : { ketQua: 'nhieu', khach, conNua: true }),
  sp: async (i) => { const ds = sp[i.ten] ?? []; return { sp: ds, ganDung: false, conNua: false }; },
});

describe('cầm lái — ca thật 16:22 27/08 "A quyết. 2 cái Fa 100w . Giá 0 đồng. lên đơn"', () => {
  it('lượt 1: model tra khách + SP, 10 Quyết → hỏi chọn (danh sách từ dữ liệu), dòng tặng giữ nguyên trong phiên', async () => {
    const generate = modelGia([
      goiNhieu([['tim_khach', { ten: 'A quyết' }], ['tim_sp', { ten: 'Fa 100w' }]]),
      goiTool('cap_nhat_phien', {
        y_dinh: 'dat_hang', che: 'dat_hang',
        khach: { trangThai: 'da_co', giaTri: { ten: 'A quyết' } },
        dong: [{ ten: 'Fa 100w', spId: 501, soLuong: { trangThai: 'da_co', giaTri: 2 }, donGia: { trangThai: 'thieu' }, tang: true }],
      }),
    ]);
    const { deps, kho, tin, taoDon } = dungDeps(generate, timGia(KHACH_QUYET, { 'Fa 100w': SP_PHA }));
    const kq = await laiLuotNhanVien(deps, { orgId: 'o', conversationId: 'c1', seq: 1, cau: 'A quyết. 2 cái Fa 100w . Giá 0 đồng. lên đơn', lichSu: [] });
    expect(kq.nhan).toBe(true);
    expect(taoDon).not.toHaveBeenCalled();
    expect(tin[0]).toContain('Anh Quyết Nelia'); // danh sách chọn có người đúng
    expect(tin[0]).toContain('chọn giúp em');
    const p = kho.get('c1')!;
    expect(p.dong).toHaveLength(1);
    expect(p.dong[0]).toMatchObject({ spId: 501, tang: true, tenOdoo: 'Đèn Pha 100W Trắng (cái)' });
    expect(p.bangChung?.khach.map((k) => k.id)).toContain(102);
  });

  it('lượt 2: NV gõ "3" → model đối chiếu bằng chứng điền id=102 → code kiểm id có trong bằng chứng → lên đơn TẶNG, không hỏi giá', async () => {
    const generate = modelGia([
      goiTool('cap_nhat_phien', { y_dinh: 'dat_hang', che: 'dat_hang', khach: { trangThai: 'da_co', giaTri: { ten: 'A quyết', id: 102 } } }),
    ]);
    const { deps, kho, tin, taoDon } = dungDeps(generate, timGia(KHACH_QUYET, { 'Fa 100w': SP_PHA }));
    const p0 = phienTrong('nhanvien');
    p0.che = 'dat_hang';
    p0.khach = { trangThai: 'da_co', giaTri: { ten: 'A quyết' } };
    p0.dong = [{ ten: 'Fa 100w', spId: 501, tenOdoo: 'Đèn Pha 100W Trắng (cái)', giaOdoo: 0, soLuong: { trangThai: 'da_co', giaTri: 2 }, donGia: { trangThai: 'thieu' }, tang: true }];
    p0.bangChung = { khach: KHACH_QUYET, sp: SP_PHA };
    kho.set('c1', p0);
    const kq = await laiLuotNhanVien(deps, { orgId: 'o', conversationId: 'c1', seq: 2, cau: '3', lichSu: [{ vai: 'bot', noiDung: 'Có 10 khách tên "A quyết": … 3) Anh Quyết Nelia' }] });
    expect(kq.nhan).toBe(true);
    expect(taoDon).toHaveBeenCalledTimes(1);
    const vao = taoDon.mock.calls[0][1] as { khach_hang_id: number; dong: Array<Record<string, unknown>> };
    expect(vao.khach_hang_id).toBe(102);
    expect(vao.dong).toEqual([{ san_pham_id: 501, so_luong: 2, tang: true }]);
    expect(tin.join('\n')).toContain('S99001');
    expect(tin.join('\n')).toContain('TẶNG');
    expect(kho.get('c1')!.donVuaLen?.maDon).toBe('S99001');
    // Không có lời gọi model nào có ý "hỏi giá": phiên không còn ô thiếu
    expect(kho.get('c1')!.che).toBe('khong');
  });

  it('lượt 3: NV gõ "3" lần nữa → model bảo xac_nhan → trả lời đơn đã lên, KHÔNG tạo đơn thứ hai', async () => {
    const generate = modelGia([goiTool('cap_nhat_phien', { y_dinh: 'xac_nhan', che: 'dat_hang' })]);
    const { deps, kho, tin, taoDon } = dungDeps(generate, timGia(KHACH_QUYET, {}));
    const p0 = phienTrong('nhanvien');
    p0.che = 'khong';
    p0.khach = { trangThai: 'da_co', giaTri: { ten: 'Anh Quyết Nelia', id: 102 } };
    p0.dong = [{ ten: 'Fa 100w', spId: 501, soLuong: { trangThai: 'da_co', giaTri: 2 }, donGia: { trangThai: 'thieu' }, tang: true }];
    p0.bangChung = { khach: KHACH_QUYET, sp: SP_PHA };
    p0.donVuaLen = { donId: 990001, maDon: 'S99001', tenKhach: 'Anh Quyết Nelia', khachId: 102, luc: new Date().toISOString() };
    kho.set('c1', p0);
    const kq = await laiLuotNhanVien(deps, { orgId: 'o', conversationId: 'c1', seq: 3, cau: '3', lichSu: [] });
    expect(kq.nhan).toBe(true);
    expect(taoDon).not.toHaveBeenCalled();
    expect(tin[0]).toContain('S99001');
  });
});

describe('cầm lái — S3 "Lộc led 88 / 30b f30 full 26803 đầu trong x 5200" một lượt ra đơn', () => {
  it('model tra SP thấy 2 loại, tin đã nói "đầu trong" → điền spId=702 + SL 30 + giá 5200; khách tra ra một người → đơn 30 × 5200', async () => {
    const generate = modelGia([
      goiNhieu([['tim_khach', { ten: 'Lộc led 88' }], ['tim_sp', { ten: 'f30 full 26803 đầu trong' }]]),
      goiTool('cap_nhat_phien', {
        y_dinh: 'dat_hang', che: 'dat_hang',
        khach: { trangThai: 'da_co', giaTri: { ten: 'Lộc led 88', id: 323 } },
        dong: [{ ten: 'f30 full 26803 đầu trong', spId: 702, soLuong: { trangThai: 'da_co', giaTri: 30 }, donGia: { trangThai: 'da_co', giaTri: 5200 } }],
      }),
    ]);
    const { deps, tin, taoDon } = dungDeps(generate, timGia([{ id: 323, ten: 'Anh Lộc Led88', ma: 'KH000323', sdt: null }], { 'f30 full 26803 đầu trong': SP_F30 }));
    const kq = await laiLuotNhanVien(deps, { orgId: 'o', conversationId: 'c3', seq: 1, cau: 'Lộc led 88 / 30b f30 full 26803 đầu trong x 5200', lichSu: [] });
    expect(kq.nhan).toBe(true);
    const vao = taoDon.mock.calls[0][1] as { khach_hang_id: number; dong: Array<Record<string, unknown>> };
    expect(vao.khach_hang_id).toBe(323);
    expect(vao.dong).toEqual([{ san_pham_id: 702, so_luong: 30, don_gia: 5200 }]);
    expect(tin[0]).toContain('30 × F30 Full 26803 Trong');
  });

  it('sửa đơn sau khi đã lên: model đưa danh sách sau sửa (SL 20) → sua_don với doi (SP đã có trên đơn)', async () => {
    const generate = modelGia([
      goiTool('cap_nhat_phien', {
        y_dinh: 'sua_don', che: 'sua_don',
        dong: [{ ten: 'f30 full 26803 đầu trong', spId: 702, soLuong: { trangThai: 'da_co', giaTri: 20 }, donGia: { trangThai: 'da_co', giaTri: 5200 } }],
      }),
    ]);
    const { deps, kho, tin, suaDon, taoDon } = dungDeps(generate, timGia([], { 'f30 full 26803 đầu trong': SP_F30 }));
    const p0 = phienTrong('nhanvien');
    p0.che = 'khong';
    p0.khach = { trangThai: 'da_co', giaTri: { ten: 'Anh Lộc Led88', id: 323, maKh: 'KH000323' } };
    p0.dong = [{ ten: 'f30 full 26803 đầu trong', spId: 702, tenOdoo: SP_F30[1].ten, giaOdoo: 5200, soLuong: { trangThai: 'da_co', giaTri: 30 }, donGia: { trangThai: 'da_co', giaTri: 5200 } }];
    p0.bangChung = { khach: [{ id: 323, ten: 'Anh Lộc Led88', ma: 'KH000323', sdt: null }], sp: SP_F30 };
    p0.donVuaLen = { donId: 990001, maDon: 'S99001', tenKhach: 'Anh Lộc Led88', khachId: 323, luc: new Date().toISOString() };
    kho.set('c3', p0);
    const kq = await laiLuotNhanVien(deps, { orgId: 'o', conversationId: 'c3', seq: 2, cau: 'sửa đơn số lượng 20b', lichSu: [] });
    expect(kq.nhan).toBe(true);
    expect(taoDon).not.toHaveBeenCalled();
    expect(suaDon).toHaveBeenCalledTimes(1);
    expect(suaDon.mock.calls[0][0]).toMatchObject({ don_id: 990001, doi: [{ san_pham_id: 702, so_luong: 20, don_gia: 5200 }], them: [] });
    expect(tin[0]).toContain('sửa đơn nháp S99001');
  });
});

describe('cầm lái — hàng rào DỮ LIỆU (không đọc chữ)', () => {
  it('model điền id không có trong bằng chứng → bỏ id, tra bù; SP chưa có giá & NV chưa báo → hỏi giá, KHÔNG ghi Odoo', async () => {
    const generate = modelGia([
      goiTool('cap_nhat_phien', {
        y_dinh: 'dat_hang', che: 'dat_hang',
        khach: { trangThai: 'da_co', giaTri: { ten: 'Lộc led 88', id: 4444 } }, // 4444 = bịa
        dong: [{ ten: 'Fa 100w', spId: 8888, soLuong: { trangThai: 'da_co', giaTri: 2 }, donGia: { trangThai: 'thieu' } }],
      }),
    ]);
    const { deps, kho, tin, taoDon } = dungDeps(generate, timGia([{ id: 323, ten: 'Anh Lộc Led88', ma: 'KH000323', sdt: null }], { 'Fa 100w': SP_PHA }));
    const kq = await laiLuotNhanVien(deps, { orgId: 'o', conversationId: 'c4', seq: 1, cau: 'x', lichSu: [] });
    expect(kq.nhan).toBe(true);
    expect(taoDon).not.toHaveBeenCalled();
    const p = kho.get('c4')!;
    expect(p.khach.giaTri?.id).toBe(323); // tra bù ra đúng một người → điền
    expect(p.dong[0].spId).toBe(501); // tra bù một kết quả → điền
    expect(p.dong[0].donGia.trangThai).toBe('mo_ho'); // giá hệ thống 0, NV chưa báo
    expect(tin[0]).toContain('báo giá');
  });

  it('doiChieuBangChung / duDeGhi / soanCauHoi là hàm thuần trên object', () => {
    const p = phienTrong('nhanvien');
    p.che = 'dat_hang';
    p.khach = { trangThai: 'da_co', giaTri: { ten: 'X', id: 1 } };
    p.dong = [{ ten: 'a', spId: 9, soLuong: { trangThai: 'da_co', giaTri: 1 }, donGia: { trangThai: 'thieu' } }];
    const bc = { khach: [{ id: 1, ten: 'Khách X', ma: 'KH1', sdt: null }], sp: [{ id: 9, ten: 'SP A', gia: 100, donVi: null }] };
    expect(doiChieuBangChung(p, bc)).toEqual({ khachBia: false, spBia: [] });
    expect(p.khach.giaTri?.ten).toBe('Khách X');
    expect(p.dong[0]).toMatchObject({ tenOdoo: 'SP A', giaOdoo: 100 });
    expect(duDeGhi(p, { sp: [] })).toBe(true);
    expect(duDeGhi(p, { sp: [{ ten: 'a', ds: [], khongThay: true, ganDung: false }] })).toBe(false);
    const hoi = soanCauHoi(p, { khach: { ten: 'Long', ds: [{ id: 1, ten: 'Anh Long', ma: 'KH1', sdt: null }, { id: 2, ten: 'Anh Long Led', ma: 'KH2', sdt: null }], conNua: false, khongThay: false }, sp: [] }, []);
    expect(hoi).toContain('1) Anh Long');
    expect(hoi).toContain('2) Anh Long Led');
  });

  it('y_dinh không phải việc đơn (hỏi tồn) → nhan=false, agent thường xử; huỷ → xoá phiên, báo', async () => {
    const g1 = modelGia([goiTool('cap_nhat_phien', { y_dinh: 'hoi_ton', che: 'khong' })]);
    const a = dungDeps(g1, timGia([], {}));
    expect((await laiLuotNhanVien(a.deps, { orgId: 'o', conversationId: 'c5', seq: 1, cau: 'tồn nguồn 12v', lichSu: [] })).nhan).toBe(false);
    expect(a.tin).toEqual([]);
    const g2 = modelGia([goiTool('cap_nhat_phien', { y_dinh: 'huy', che: 'khong' })]);
    const b = dungDeps(g2, timGia([], {}));
    b.kho.set('c6', { ...phienTrong('nhanvien'), che: 'dat_hang' });
    expect((await laiLuotNhanVien(b.deps, { orgId: 'o', conversationId: 'c6', seq: 1, cau: 'thôi huỷ', lichSu: [] })).nhan).toBe(true);
    expect(b.kho.has('c6')).toBe(false);
    expect(b.tin[0]).toContain('huỷ');
  });

  it('model lỗi/timeout → nguon=loi, nhan=false, không gửi gì (luồng rơi về đường cũ)', async () => {
    const treo = (() => new Promise<AgentTurn>(() => {})) as unknown as ToolAwareGenerate;
    const a = dungDeps(treo, timGia([], {}));
    a.deps.timeoutMs = 50;
    const kq = await laiLuotNhanVien(a.deps, { orgId: 'o', conversationId: 'c7', seq: 1, cau: 'x', lichSu: [] });
    expect(kq).toMatchObject({ nhan: false, nguon: 'loi' });
    expect(a.tin).toEqual([]);
  });

  it('khách mo_ho KHÔNG kèm giaTri nhưng model đã tra (traKhachCuoi) → liệt kê đúng danh sách; có goiY áp đảo → tự chốt', async () => {
    const g1 = modelGia([goiTool('cap_nhat_phien', { y_dinh: 'dat_hang', che: 'dat_hang', khach: { trangThai: 'mo_ho', ghiChu: 'trùng 10 người' }, dong: [{ ten: 'Fa 100w', spId: 501, soLuong: { trangThai: 'da_co', giaTri: 2 }, donGia: { trangThai: 'thieu' }, tang: true }] })]);
    const a = dungDeps(g1, timGia(KHACH_QUYET, { 'Fa 100w': SP_PHA }));
    const p0 = phienTrong('nhanvien');
    p0.bangChung = { khach: KHACH_QUYET, sp: SP_PHA, traKhachCuoi: { hoi: 'A quyết', ds: KHACH_QUYET, conNua: true } };
    a.kho.set('c8', p0);
    await laiLuotNhanVien(a.deps, { orgId: 'o', conversationId: 'c8', seq: 1, cau: 'A quyết. 2 cái Fa 100w', lichSu: [] });
    expect(a.tin[0]).toContain('3) Anh Quyết Nelia');
    expect(a.kho.get('c8')!.dangHoi?.khach?.ds.map((x) => x.id)).toContain(102);
    const g2 = modelGia([goiTool('cap_nhat_phien', { y_dinh: 'dat_hang', che: 'dat_hang', khach: { trangThai: 'mo_ho', ghiChu: 'nhiều Long Led' }, dong: [{ ten: 'cáp', spId: 501, soLuong: { trangThai: 'da_co', giaTri: 16 }, donGia: { trangThai: 'da_co', giaTri: 7000 } }] })]);
    const b = dungDeps(g2, timGia([], { cáp: SP_PHA }));
    const p1 = phienTrong('nhanvien');
    const LONG = [{ id: 1, ten: 'Anh Long Led', ma: 'KH000117', sdt: null }, { id: 2, ten: 'led bảo long Anh Long', ma: 'KH2', sdt: null }];
    p1.bangChung = { khach: LONG, sp: SP_PHA, traKhachCuoi: { hoi: 'a long led', ds: LONG, conNua: false, goiY: 1 } };
    b.kho.set('c9', p1);
    await laiLuotNhanVien(b.deps, { orgId: 'o', conversationId: 'c9', seq: 1, cau: 'a long led, cáp 16 sợi 7k lên đơn', lichSu: [] });
    expect(b.taoDon).toHaveBeenCalledTimes(1);
    expect((b.taoDon.mock.calls[0][1] as { khach_hang_id: number }).khach_hang_id).toBe(1);
  });

  it('soát số trước khi ghi: model chính lấy "4 bóng" làm SL 4, lượt soát sửa thành 400 → Odoo nhận 400', async () => {
    const generate = modelGia([
      goiTool('cap_nhat_phien', {
        y_dinh: 'dat_hang', che: 'dat_hang',
        khach: { trangThai: 'da_co', giaTri: { ten: 'anh việt nguyễn xiển', id: 2532 } },
        dong: [{ ten: '4 bóng lixin 220v 4000K', spId: 1921, soLuong: { trangThai: 'da_co', giaTri: 4 }, donGia: { trangThai: 'da_co', giaTri: 3200 } }],
      }),
      goiTool('ket_luan_so', { ok: false, dong: [{ stt: 1, ten: '4 bóng lixin 220v 4000K', soLuong: 400, donGia: 3200 }], ly_do: '"400b" là 400 bóng' }),
    ]);
    const a = dungDeps(generate, timGia([{ id: 2532, ten: 'anh việt nguyễn xiển - 0911833666', ma: 'KH001033', sdt: null }], {}));
    a.deps.kiemSo = true;
    const p0 = phienTrong('nhanvien');
    p0.bangChung = { khach: [{ id: 2532, ten: 'anh việt nguyễn xiển - 0911833666', ma: 'KH001033', sdt: null }], sp: [{ id: 1921, ten: 'Led 4 bóng Lixin 220V trong nhà Trung tính 4000K', gia: 1, donVi: 'bóng' }] };
    a.kho.set('c10', p0);
    await laiLuotNhanVien(a.deps, { orgId: 'o', conversationId: 'c10', seq: 1, cau: 'anh việt nguyễn xiển 400b 4 bóng lixin 220v 4000K giá 3200', lichSu: [] });
    expect(a.taoDon).toHaveBeenCalledTimes(1);
    expect((a.taoDon.mock.calls[0][1] as { dong: unknown[] }).dong).toEqual([{ san_pham_id: 1921, so_luong: 400, don_gia: 3200 }]);
    expect(generate.goi[1].tools.map((t) => t.name)).toEqual(['ket_luan_so']);
  });
});
