// SPDX-License-Identifier: AGPL-3.0-or-later
// QUYỀN BOT (docs/77 §3.2) — dựng payload CÔNG KHAI cho bot: {phien_ban, nhom, nhan_vien}.
//
// Đây là HỢP ĐỒNG với bridge Python của bot (poll ~60 s): khoá snake_case, giá trị lấy từ enum
// docs/77 §2, nhom sắp theo conversation_id, nhan_vien sắp theo zalo_uid. Bot so `phien_ban` để
// biết có cần áp lại không ⇒ phien_ban = sha256 (hex) của JSON CHUẨN (khoá sắp xếp đệ quy) của
// đúng hai mảng này: cùng dữ liệu ⇒ cùng chuỗi, đổi bất kỳ ô nào ⇒ chuỗi khác. Ô ngoài payload
// (ghi chú, người/lúc cập nhật) KHÔNG làm đổi phiên bản — bot không cần áp lại vì chúng.
//
// `nick_uid` (vòng sửa 1): uid Zalo của CHÍNH nick CRM nhìn nhóm (ZaloAccount.zaloUid của hội thoại, null khi
// nick chưa có uid). Bot nạp các uid này vào bảng nick_bot — tin của nick đó trong nhóm không bị coi là người
// ngoài. Nhóm chuyển sang nick khác / nick đổi uid ⇒ phien_ban đổi.
import { createHash } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { withTenant } from '../../shared/tenant/tenant-context.js';

export interface NhomCongKhai {
  conversation_id: string;
  external_thread_id: string | null;
  nick_uid: string | null;
  chuc_nang: string;
  ten_dang_ky: string;
}

export interface NhanVienCongKhai {
  zalo_uid: string;
  ten_goi: string;
  vai: string;
  trang_thai: string;
}

export interface CauHinhCongKhai {
  phien_ban: string;
  nhom: NhomCongKhai[];
  nhan_vien: NhanVienCongKhai[];
}

/** JSON chuẩn: khoá object sắp xếp đệ quy, mảng giữ thứ tự, không khoảng trắng. */
export function jsonChuan(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(jsonChuan).join(',')}]`;
  const o = v as Record<string, unknown>;
  const khoa = Object.keys(o).filter((k) => o[k] !== undefined).sort(soSanh);
  return `{${khoa.map((k) => `${JSON.stringify(k)}:${jsonChuan(o[k])}`).join(',')}}`;
}

/** So theo điểm mã — không phụ thuộc locale máy chủ (localeCompare thì có). */
function soSanh(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Ghép dòng DB thành payload + phiên bản. Thuần — test được không cần DB. */
export function ghepCauHinhCongKhai(
  nhom: ReadonlyArray<{
    conversationId: string; externalThreadId: string | null; nickUid: string | null; chucNang: string; tenDangKy: string;
  }>,
  nhanVien: ReadonlyArray<{ zaloUid: string; tenGoi: string; vai: string; trangThai: string }>,
): CauHinhCongKhai {
  const n: NhomCongKhai[] = nhom
    .map((r) => ({
      // Thứ tự khoá = thứ tự trong JSON trả về (hợp đồng): conversation_id, external_thread_id, nick_uid,
      // chuc_nang, ten_dang_ky. Băm dùng JSON chuẩn (khoá sắp xếp) nên thứ tự này không ảnh hưởng phien_ban.
      conversation_id: r.conversationId,
      external_thread_id: r.externalThreadId,
      nick_uid: r.nickUid,
      chuc_nang: r.chucNang,
      ten_dang_ky: r.tenDangKy,
    }))
    .sort((a, b) => soSanh(a.conversation_id, b.conversation_id));
  const v: NhanVienCongKhai[] = nhanVien
    .map((r) => ({ zalo_uid: r.zaloUid, ten_goi: r.tenGoi, vai: r.vai, trang_thai: r.trangThai }))
    .sort((a, b) => soSanh(a.zalo_uid, b.zalo_uid));
  const phien_ban = createHash('sha256').update(jsonChuan({ nhom: n, nhan_vien: v })).digest('hex');
  return { phien_ban, nhom: n, nhan_vien: v };
}

/**
 * Đọc cấu hình của MỘT org. Chỉ nhóm ĐÃ xếp loại (có dòng BotNhom) — nhóm chưa xếp loại vắng mặt
 * và bot coi là im. Mọi NV (kể cả khoa/nghi — bot cần biết người nghỉ để im nhóm có họ).
 */
export async function docCauHinhCongKhai(orgId: string): Promise<CauHinhCongKhai> {
  return withTenant(orgId, async () => {
    const [nhom, nhanVien] = await Promise.all([
      prisma.botNhom.findMany({
        where: { orgId },
        select: {
          conversationId: true, chucNang: true, tenDangKy: true,
          conversation: { select: { externalThreadId: true, zaloAccount: { select: { zaloUid: true } } } },
        },
      }),
      prisma.botNhanVien.findMany({
        where: { orgId },
        select: { zaloUid: true, tenGoi: true, vai: true, trangThai: true },
      }),
    ]);
    return ghepCauHinhCongKhai(
      nhom.map((r) => ({
        conversationId: r.conversationId,
        externalThreadId: r.conversation.externalThreadId,
        nickUid: r.conversation.zaloAccount.zaloUid,
        chucNang: r.chucNang,
        tenDangKy: r.tenDangKy,
      })),
      nhanVien,
    );
  });
}
