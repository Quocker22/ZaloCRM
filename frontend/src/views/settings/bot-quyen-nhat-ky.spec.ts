// SPDX-License-Identifier: AGPL-3.0-or-later
// Nhật ký quyền bot: mỗi dòng đọc thành MỘT câu dựng từ trước/sau (+ lý do).
import { describe, it, expect } from 'vitest';
import type { NhatKy } from '@/api/bot-quyen';
import { cauNhatKy } from './bot-quyen-nhat-ky';

const nk = (them: Partial<NhatKy>): NhatKy => ({
  id: 'k1', luc: '2026-09-30T02:00:00.000Z', aiId: 'u1', ai: { id: 'u1', fullName: 'Nguyễn A' }, tuDong: false,
  doiTuong: 'nhom', doiTuongId: 'c1', tenDoiTuong: 'Sales HN', truoc: null, sau: null, lyDo: null, ...them,
});
const nhom = (chucNang: string, tenDangKy = '', ghiChu: string | null = null) => ({ chucNang, tenDangKy, ghiChu });
const nv = (them: Record<string, unknown> = {}) => ({
  zaloUid: '555', tenGoi: 'Lan', vai: 'sales', trangThai: 'hoat_dong', userId: null, ghiChu: null, ...them,
});

describe('cauNhatKy — nhóm', () => {
  it('đổi chức năng + lý do (ví dụ đã chốt)', () => {
    expect(cauNhatKy(nk({ truoc: nhom('sales'), sau: nhom('admin'), lyDo: 'nhóm quản lý' }))).toBe(
      'Nguyễn A đổi nhóm “Sales HN” từ Bán hàng sang Quản trị — lý do: nhóm quản lý',
    );
  });
  it('xếp loại lần đầu', () => {
    expect(cauNhatKy(nk({ sau: nhom('khach') }))).toBe('Nguyễn A xếp nhóm “Sales HN” là Khách');
  });
  it('bỏ xếp loại ⇒ nói bot im', () => {
    expect(cauNhatKy(nk({ truoc: nhom('kho'), sau: null, lyDo: 'nhóm cũ' }))).toBe(
      'Nguyễn A bỏ xếp loại nhóm “Sales HN” (trước là Kho) — bot im trong nhóm — lý do: nhóm cũ',
    );
  });
  it('chỉ đổi tên đăng ký / ghi chú', () => {
    expect(cauNhatKy(nk({ truoc: nhom('sales', 'Sales HN'), sau: nhom('sales', 'Bán hàng HN', 'ca sáng') }))).toBe(
      'Nguyễn A sửa nhóm “Sales HN”: tên đăng ký từ “Sales HN” sang “Bán hàng HN”; ghi chú từ “(trống)” sang “ca sáng”',
    );
  });
  it('đổi chức năng kèm đổi tên đăng ký', () => {
    expect(cauNhatKy(nk({ truoc: nhom('sales', 'A'), sau: nhom('ke_toan', 'B') }))).toBe(
      'Nguyễn A đổi nhóm “Sales HN” từ Bán hàng sang Kế toán; tên đăng ký từ “A” sang “B”',
    );
  });
  it('nhóm mất tên Zalo ⇒ dùng tên đăng ký; người làm đã bị xoá', () => {
    expect(cauNhatKy(nk({ tenDoiTuong: null, ai: null, sau: nhom('sales', 'Kho HCM') }))).toBe(
      'Người dùng đã bị xoá xếp nhóm “Kho HCM” là Bán hàng',
    );
  });
});

describe('cauNhatKy — mặc định TỰ ĐỔI (góp ý chủ (4))', () => {
  it('sales → khach có lý do: câu không có người làm, nói rõ "(mặc định)"', () => {
    expect(cauNhatKy(nk({
      aiId: 'tu_dong', ai: null, tuDong: true,
      truoc: { chucNang: 'sales', macDinh: true }, sau: { chucNang: 'khach', macDinh: true },
      lyDo: 'có người ngoài vào nhóm: Lạ Văn A',
    }))).toBe('Nhóm “Sales HN”: Nhóm nhân viên (mặc định) → Khách (mặc định) — có người ngoài vào nhóm: Lạ Văn A');
  });
  it('khach → sales', () => {
    expect(cauNhatKy(nk({
      aiId: 'tu_dong', ai: null, tuDong: true,
      truoc: { chucNang: 'khach', macDinh: true }, sau: { chucNang: 'sales', macDinh: true }, lyDo: 'mọi thành viên đều là nhân viên',
    }))).toBe('Nhóm “Sales HN”: Khách (mặc định) → Nhóm nhân viên (mặc định) — mọi thành viên đều là nhân viên');
  });
});

describe('cauNhatKy — nhân viên', () => {
  it('thêm nhân viên', () => {
    expect(cauNhatKy(nk({ doiTuong: 'nhan_vien', doiTuongId: 'n1', tenDoiTuong: 'Lan', sau: nv() }))).toBe(
      'Nguyễn A thêm nhân viên “Lan” (Zalo 555) với vai Bán hàng, trạng thái Hoạt động',
    );
  });
  it('thêm người công ty kèm lý do', () => {
    expect(cauNhatKy(nk({
      doiTuong: 'nhan_vien', tenDoiTuong: 'Tài xế', sau: nv({ tenGoi: 'Tài xế', vai: 'cong_ty' }), lyDo: 'tài xế giao hàng',
    }))).toBe(
      'Nguyễn A thêm nhân viên “Tài xế” (Zalo 555) với vai Người công ty (không dùng bot), trạng thái Hoạt động — lý do: tài xế giao hàng',
    );
  });
  it('hạ vai + khoá', () => {
    expect(cauNhatKy(nk({
      doiTuong: 'nhan_vien', tenDoiTuong: 'Lan', truoc: nv({ vai: 'admin' }), sau: nv({ trangThai: 'khoa' }), lyDo: 'nghỉ phép',
    }))).toBe('Nguyễn A đổi nhân viên “Lan”: vai từ Quản trị sang Bán hàng; trạng thái từ Hoạt động sang Khoá — lý do: nghỉ phép');
  });
  it('đổi tên gọi, liên kết tài khoản CRM (tra tên), ghi chú', () => {
    const tenNguoiDung = (id: string) => (id === 'crm1' ? 'Trần B' : null);
    expect(cauNhatKy(nk({
      doiTuong: 'nhan_vien', tenDoiTuong: 'Lan Anh',
      truoc: nv(), sau: nv({ tenGoi: 'Lan Anh', userId: 'crm1', ghiChu: 'ca tối' }),
    }), { tenNguoiDung })).toBe(
      'Nguyễn A đổi nhân viên “Lan Anh”: tên gọi từ “Lan” sang “Lan Anh”; tài khoản CRM từ (không liên kết) sang Trần B; ghi chú từ “(trống)” sang “ca tối”',
    );
  });
  it('tài khoản CRM không còn trong danh sách ⇒ ghi rõ', () => {
    expect(cauNhatKy(nk({
      doiTuong: 'nhan_vien', tenDoiTuong: 'Lan', truoc: nv({ userId: 'mat' }), sau: nv(),
    }))).toBe('Nguyễn A đổi nhân viên “Lan”: tài khoản CRM từ (tài khoản không còn) sang (không liên kết)');
  });
});

describe('nhiều uid (docs/77 §8b)', () => {
  const goc = {
    id: 'x', luc: '2026-09-30T03:00:00.000Z', aiId: 'u1', ai: { id: 'u1', fullName: 'Nguyễn A' }, tuDong: false,
    doiTuong: 'nhan_vien', doiTuongId: 'n1', tenDoiTuong: 'Trần Hưng', lyDo: null,
  } as const;
  it('thêm NV nhiều uid', () => {
    expect(cauNhatKy({ ...goc, truoc: null, sau: { zaloUid: '1', tenGoi: 'Trần Hưng', vai: 'admin', trangThai: 'hoat_dong', uids: ['1', '2'] } }))
      .toBe('Nguyễn A thêm nhân viên “Trần Hưng” (Zalo 1, 2) với vai Quản trị, trạng thái Hoạt động');
  });
  it('người thêm uid ở nick khác', () => {
    expect(cauNhatKy({ ...goc, truoc: { tenGoi: 'Trần Hưng', uids: ['1'] }, sau: { tenGoi: 'Trần Hưng', uids: ['1', '3'] }, lyDo: 'cùng người' }))
      .toBe('Nguyễn A đổi nhân viên “Trần Hưng”: thêm Zalo ở nick khác 3 — lý do: cùng người');
  });
  it('hệ thống tự thêm', () => {
    expect(cauNhatKy({
      ...goc, aiId: 'tu_dong', ai: null, tuDong: true, truoc: { tenGoi: 'Trần Hưng', uids: ['1'] },
      sau: { tenGoi: 'Trần Hưng', uids: ['1', '2'] }, lyDo: 'nhận ra cùng người ở nick khác (cùng tin nhắn trong nhóm chung)',
    })).toBe('Nhân viên “Trần Hưng”: thêm Zalo 2 — nhận ra cùng người ở nick khác (cùng tin nhắn trong nhóm chung)');
  });
});

describe('an toàn nhiều uid (docs/77 §8b-an-toàn)', () => {
  const goc = {
    id: 'x', luc: '2026-09-30T03:00:00.000Z', aiId: 'u1', ai: { id: 'u1', fullName: 'Nguyễn A' }, tuDong: false,
    doiTuong: 'nhan_vien', doiTuongId: 'n1', tenDoiTuong: 'Trần Hưng', lyDo: null,
  } as const;
  it('gỡ uid (kèm bằng chứng globalId)', () => {
    expect(cauNhatKy({
      ...goc, truoc: { tenGoi: 'Trần Hưng', uids: ['1', '2'] },
      sau: { tenGoi: 'Trần Hưng', uids: ['1'], goUid: { zaloUid: '2', nguon: 'zalo_global_id', bangChung: { globalId: 'G1' } } }, lyDo: 'nối sai',
    })).toBe('Nguyễn A đổi nhân viên “Trần Hưng”: gỡ Zalo 2 (globalId Zalo G1) — lý do: nối sai');
  });
  it('nối đề xuất tin chung / từ chối đề xuất', () => {
    expect(cauNhatKy({
      ...goc, truoc: { tenGoi: 'Trần Hưng', uids: ['1'] },
      sau: { tenGoi: 'Trần Hưng', uids: ['1', '2'], xacNhan: { zaloUid: '2', soTin: 236 } },
    })).toBe('Nguyễn A đổi nhân viên “Trần Hưng”: nối đề xuất Zalo 2 (236 tin trùng)');
    expect(cauNhatKy({ ...goc, truoc: null, sau: { tenGoi: 'Trần Hưng', tuChoi: { zaloUid: '9', soTin: 2 } }, lyDo: 'em trai' }))
      .toBe('Nguyễn A xác nhận Zalo 9 KHÔNG phải nhân viên “Trần Hưng” (2 tin trùng) — lý do: em trai');
  });
  it('hệ thống chuyển uid tự nối cũ thành đề xuất', () => {
    expect(cauNhatKy({
      ...goc, aiId: 'tu_dong', ai: null, tuDong: true, truoc: { tenGoi: 'Trần Hưng', uids: ['1', '2'] },
      sau: { tenGoi: 'Trần Hưng', uids: ['1'], thanhDeXuat: ['2'] }, lyDo: 'tin chung chỉ là bằng chứng phụ',
    })).toBe('Nhân viên “Trần Hưng”: chuyển Zalo 2 thành đề xuất — tin chung chỉ là bằng chứng phụ');
  });
  it('nick CRM: hệ thống nhận ra / chủ đánh dấu / chủ gỡ', () => {
    const k = { ...goc, doiTuong: 'nick_crm', doiTuongId: 'tm', tenDoiTuong: 'Tiểu Mã Nelia' };
    expect(cauNhatKy({ ...k, aiId: 'tu_dong', ai: null, tuDong: true, truoc: null,
      sau: { nhinTu: 'vt', zaloUid: '2945', nguon: 'zalo_global_id', bangChung: { globalId: 'G-TM' } }, lyDo: null }))
      .toBe('Hệ thống nhận ra Zalo 2945 là nick CRM “Tiểu Mã Nelia” (globalId Zalo G-TM)');
    expect(cauNhatKy({ ...k, truoc: null, sau: { nhinTu: 'vt', zaloUid: '2945', nickId: 'tm' }, lyDo: 'đúng' }))
      .toBe('Nguyễn A đánh dấu Zalo 2945 là nick CRM “Tiểu Mã Nelia” — lý do: đúng');
    expect(cauNhatKy({ ...k, truoc: { zaloUid: '2945' }, sau: { zaloUid: '2945', tuChoi: true }, lyDo: 'sai' }))
      .toBe('Nguyễn A gỡ Zalo 2945 khỏi nick CRM “Tiểu Mã Nelia” — lý do: sai');
  });
});

describe('thông báo chủ động (docs/78 C2)', () => {
  const luat = (them: Record<string, unknown> = {}) => ({
    loai: 'in_sau_chot', dich: [{ kieu: 'chuc_nang', gia_tri: 'kho' }], cheDo: 'bong', dieuKien: {}, gomGiay: 0, lich: null, phienBan: 1, ...them,
  });
  it('luật thông báo: tạo / sửa chế độ / xoá; script gieo đọc là "Script quản trị"', () => {
    const k = nk({ doiTuong: 'luat_thong_bao', doiTuongId: 'l1', tenDoiTuong: null });
    expect(cauNhatKy({ ...k, sau: luat() })).toBe('Nguyễn A tạo luật thông báo “in_sau_chot” (Bóng)');
    expect(cauNhatKy({ ...k, truoc: luat(), sau: luat({ cheDo: 'bat', phienBan: 2 }), lyDo: 'xem số rồi' }))
      .toBe('Nguyễn A sửa luật thông báo “in_sau_chot” (Bóng → Bật) — lý do: xem số rồi');
    expect(cauNhatKy({ ...k, truoc: luat(), sau: null })).toBe('Nguyễn A xoá luật thông báo “in_sau_chot”');
    expect(cauNhatKy({ ...k, aiId: 'cli:gieo-luat-thong-bao', ai: null, sau: luat() }))
      .toBe('Script quản trị tạo luật thông báo “in_sau_chot” (Bóng)');
  });
  it('bản đồ tin: bot cập nhật danh mục (khoá API) / bị từ chối', () => {
    const k = nk({ doiTuong: 'ban_do_tin', doiTuongId: 'b1', tenDoiTuong: null, aiId: 'api_key:s1', ai: null });
    expect(cauNhatKy({ ...k, sau: { phienBan: 'dm-2', soComposer: 4, them: ['moi'], bo: [], doi: ['a'] } }))
      .toBe('Bot (khoá API) cập nhật bản đồ tin dm-2: 4 loại tin — thêm moi; đổi a');
    expect(cauNhatKy({ ...k, truoc: { phienBanGui: 'gia' }, lyDo: 'Từ chối ảnh chụp: gỡ nhạy cảm' }))
      .toBe('Bot (khoá API) gửi bản đồ tin bị TỪ CHỐI — lý do: Từ chối ảnh chụp: gỡ nhạy cảm');
  });
});

describe('cauNhatKy — cho khách (docs/79 T5)', () => {
  it('tài liệu: cho khách xem / bỏ', () => {
    expect(cauNhatKy(nk({
      doiTuong: 'tai_lieu_cho_khach', doiTuongId: 'doc-1', tenDoiTuong: 'Datasheet P10',
      truoc: { tieuDe: 'Datasheet P10', choKhach: false }, sau: { tieuDe: 'Datasheet P10', choKhach: true }, lyDo: 'công khai',
    }))).toBe('Nguyễn A cho khách xem tài liệu “Datasheet P10” — lý do: công khai');
    expect(cauNhatKy(nk({
      doiTuong: 'tai_lieu_cho_khach', doiTuongId: 'doc-1', tenDoiTuong: null,
      truoc: { tieuDe: null, choKhach: true }, sau: { tieuDe: null, choKhach: false },
    }))).toBe('Nguyễn A bỏ cho khách xem tài liệu “doc-1”');
  });
  it('tài liệu: duyệt lại sau khi nội dung đổi — nêu hai bản (8 ký tự đầu băm nội dung)', () => {
    expect(cauNhatKy(nk({
      doiTuong: 'tai_lieu_cho_khach', doiTuongId: 'doc-1', tenDoiTuong: 'Datasheet P10',
      truoc: { tieuDe: 'Datasheet P10', choKhach: true, noiDungBam: 'a'.repeat(64) },
      sau: { tieuDe: 'Datasheet P10', choKhach: true, noiDungBam: 'b'.repeat(64) },
    }))).toBe('Nguyễn A duyệt lại nội dung mới của tài liệu “Datasheet P10” cho khách (bản aaaaaaaa → bbbbbbbb)');
  });
  it('mô tả: duyệt / duyệt lại sau khi đổi / bỏ duyệt', () => {
    const b1 = 'a'.repeat(64);
    const b2 = 'b'.repeat(64);
    expect(cauNhatKy(nk({ doiTuong: 'mo_ta_duyet', doiTuongId: '11', tenDoiTuong: 'Led dây', sau: { ten: 'Led dây', moTaBam: b1 } })))
      .toBe('Nguyễn A duyệt mô tả sản phẩm “Led dây” cho khách (bản aaaaaaaa)');
    expect(cauNhatKy(nk({
      doiTuong: 'mo_ta_duyet', doiTuongId: '11', tenDoiTuong: 'Led dây', truoc: { ten: 'Led dây', moTaBam: b1 }, sau: { ten: 'Led dây', moTaBam: b2 },
    }))).toBe('Nguyễn A duyệt lại mô tả sản phẩm “Led dây” cho khách (bản aaaaaaaa → bbbbbbbb)');
    expect(cauNhatKy(nk({ doiTuong: 'mo_ta_duyet', doiTuongId: '11', tenDoiTuong: 'Led dây', truoc: { ten: 'Led dây', moTaBam: b1 } })))
      .toBe('Nguyễn A bỏ duyệt mô tả sản phẩm “Led dây”');
  });
  it('danh mục bot gửi', () => {
    expect(cauNhatKy(nk({
      aiId: 'api_key:s1', ai: null, doiTuong: 'danh_muc_cho_khach', tenDoiTuong: null,
      sau: { phienBan: 'dm-2', soTaiLieu: 3, soSanPham: 1200, themTaiLieu: ['d4'], boTaiLieu: [], moTaDoi: [11], soMoTaDoi: 1 },
    }))).toBe('Bot (khoá API) gửi danh mục cho khách dm-2: 3 tài liệu, 1200 sản phẩm — thêm tài liệu d4; 1 mô tả đổi');
  });
});
