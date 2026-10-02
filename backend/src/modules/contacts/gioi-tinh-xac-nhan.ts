// SPDX-License-Identifier: AGPL-3.0-or-later
// XÁC NHẬN GIỚI TÍNH Contact (docs/79 T1, 02/10) — luật THUẦN cho PUT /api/v1/contacts/:id.
//
// Vì sao: form hồ sơ lưu CẢ form (sửa SĐT / ghi chú cũng gửi kèm `gender`) và bản cũ đặt genderLocked = !!gender ⇒ mọi lần bấm
// Lưu đều "khoá tay" giới Zalo tự điền (Zalo có thể trả "Nam" mặc định). Bot gọi khách anh/chị theo dấu xác nhận
// (bot-quyen-goi.ts) nên dấu PHẢI là hành động thật của NV:
//   • `gender` vắng ⇒ không đụng gì;
//   • giá trị (sau chuẩn hoá: rỗng ⇒ null) KHÁC giá trị đang lưu ⇒ ghi gender; có giá trị ⇒ khoá + dấu (lúc, người); rỗng ⇒
//     mở khoá + xoá dấu (cho SDK tự điền lại);
//   • giá trị BẰNG giá trị đang lưu ⇒ không đụng gì (khoá cũ giữ nguyên để SDK không đè; không dấu) — TRỪ `xacNhanGioi: true`
//     (nút "Xác nhận" tường minh trên ô giới tính) với giới có giá trị ⇒ khoá + dấu.
export interface GioiDangLuu {
  gender: string | null;
}

export interface PatchGioi {
  gender?: string | null;
  genderLocked?: boolean;
  gioiTinhXacNhanLuc?: Date | null;
  gioiTinhXacNhanBoi?: string | null;
}

export function patchGioiTinh(
  dangLuu: GioiDangLuu, body: Record<string, unknown>, userId: string, bayGio: () => Date = () => new Date(),
): PatchGioi {
  if (body.gender === undefined) return {};
  const moi = typeof body.gender === 'string' && body.gender.trim() ? body.gender.trim() : null;
  const cu = dangLuu.gender && dangLuu.gender.trim() ? dangLuu.gender : null;
  if (moi === cu) {
    return body.xacNhanGioi === true && moi
      ? { genderLocked: true, gioiTinhXacNhanLuc: bayGio(), gioiTinhXacNhanBoi: userId }
      : {};
  }
  return moi
    ? { gender: moi, genderLocked: true, gioiTinhXacNhanLuc: bayGio(), gioiTinhXacNhanBoi: userId }
    : { gender: null, genderLocked: false, gioiTinhXacNhanLuc: null, gioiTinhXacNhanBoi: null };
}
