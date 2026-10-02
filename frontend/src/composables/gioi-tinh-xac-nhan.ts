// SPDX-License-Identifier: AGPL-3.0-or-later
// XÁC NHẬN GIỚI TÍNH (docs/79 T1, 02/10) — hàm THUẦN cho các form hồ sơ khách.
// Backend (contact-routes PUT + gioi-tinh-xac-nhan.ts) đóng dấu "NV đã xác nhận giới tính" khi `gender` THỰC ĐỔI; bot chỉ gọi
// khách anh/chị theo dấu đó. Form lưu cả form ⇒ chỉ gửi `gender` khi ô giới tính đổi so với giá trị lúc nạp (backend cũng tự
// so — hai lớp). Nút "Xác nhận" (giới Zalo tự điền đúng) gửi {gender, xacNhanGioi: true}.

/** `{}` khi ô giới tính không đổi; `{gender}` (rỗng ⇒ null) khi đổi. */
export function truongGioiDeGui(moi: string | null | undefined, goc: string | null | undefined): { gender?: string | null } {
  const m = moi || null;
  const g = goc || null;
  return m === g ? {} : { gender: m };
}

export type TrangThaiGioi = 'da_xac_nhan' | 'chua_xac_nhan' | 'trong';

/** Trạng thái hiển thị cạnh ô giới tính. */
export function trangThaiGioi(gender: string | null | undefined, xacNhanLuc: string | null | undefined): TrangThaiGioi {
  if (!gender) return 'trong';
  return xacNhanLuc ? 'da_xac_nhan' : 'chua_xac_nhan';
}
