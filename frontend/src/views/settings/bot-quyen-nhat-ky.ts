// SPDX-License-Identifier: AGPL-3.0-or-later
// bot-quyen-nhat-ky.ts — dựng MỘT câu tiếng Việt cho mỗi dòng nhật ký quyền bot (docs/77 §3.3 tab Nhật ký),
// từ ảnh chụp trước/sau của backend:
//   nhom      = { chucNang, tenDangKy, ghiChu }
//   nhan_vien = { zaloUid, tenGoi, vai, trangThai, userId, ghiChu, uids? } — thêm uid ở nick khác (docs/77 §8b):
//               { tenGoi, uids } → { tenGoi, uids } (người thêm tay, hoặc hệ thống "tự động")
// truoc = null ⇒ vừa tạo; sau = null ⇒ bỏ xếp loại (chỉ nhóm — nhân viên không xoá cứng).
// Ví dụ: "Nguyễn A đổi nhóm “Sales HN” từ Bán hàng sang Quản trị — lý do: …".
import type { NhatKy } from '@/api/bot-quyen';
import { nhanChucNang, nhanTrangThai, nhanVai } from './bot-quyen-luat';
import { NHAN_MAC_DINH } from './bot-quyen-mac-dinh';

type Anh = Record<string, unknown> | null;

function chuoi(a: Anh, k: string): string | null {
  const v = a?.[k];
  return typeof v === 'string' ? v : null;
}

/** “x” — rỗng/null ⇒ “(trống)”. */
function trich(x: string | null): string {
  return `“${x && x.trim() ? x : '(trống)'}”`;
}

function dsUid(a: Anh): string[] {
  const v = a?.uids;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** uid có ở `sau` mà không có ở `truoc`. */
function uidThem(truoc: Anh, sau: Anh): string[] {
  const cu = new Set(dsUid(truoc));
  return dsUid(sau).filter((u) => !cu.has(u));
}

/** uid có ở `truoc` mà không còn ở `sau` (gỡ / thành đề xuất — §8b-an-toàn). */
function uidBo(truoc: Anh, sau: Anh): string[] {
  const moi = new Set(dsUid(sau));
  return dsUid(truoc).filter((u) => !moi.has(u));
}

function obj(a: Anh, k: string): Record<string, unknown> | null {
  const v = a?.[k];
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** "(N tin trùng)" / "(globalId …)" từ ô bằng chứng. */
function chuBangChung(b: Record<string, unknown> | null): string {
  if (!b) return '';
  const bc = obj(b, 'bangChung') ?? b;
  if (typeof bc.globalId === 'string') return ` (globalId Zalo ${bc.globalId})`;
  const so = typeof b.soTin === 'number' ? b.soTin : typeof bc.soTin === 'number' ? bc.soTin : null;
  return so !== null ? ` (${so} tin trùng)` : '';
}

function doi(ten: string, a: string, b: string): string {
  return `${ten} từ ${a} sang ${b}`;
}

function cauNhom(ai: string, e: NhatKy): string {
  const truoc = e.truoc;
  const sau = e.sau;
  const ten = e.tenDoiTuong?.trim() || chuoi(sau, 'tenDangKy')?.trim() || chuoi(truoc, 'tenDangKy')?.trim() || '(nhóm chưa có tên)';
  const nhom = `nhóm “${ten}”`;
  if (!truoc && sau) return `${ai} xếp ${nhom} là ${nhanChucNang(chuoi(sau, 'chucNang'))}`;
  if (truoc && !sau) return `${ai} bỏ xếp loại ${nhom} (trước là ${nhanChucNang(chuoi(truoc, 'chucNang'))}) — bot im trong nhóm`;
  if (!truoc || !sau) return `${ai} thay đổi ${nhom}`;

  const khac: string[] = [];
  if ((chuoi(truoc, 'tenDangKy') ?? '') !== (chuoi(sau, 'tenDangKy') ?? '')) {
    khac.push(doi('tên đăng ký', trich(chuoi(truoc, 'tenDangKy')), trich(chuoi(sau, 'tenDangKy'))));
  }
  if ((chuoi(truoc, 'ghiChu') ?? '') !== (chuoi(sau, 'ghiChu') ?? '')) {
    khac.push(doi('ghi chú', trich(chuoi(truoc, 'ghiChu')), trich(chuoi(sau, 'ghiChu'))));
  }
  const cnCu = chuoi(truoc, 'chucNang');
  const cnMoi = chuoi(sau, 'chucNang');
  if (cnCu !== cnMoi) {
    const dau = `${ai} đổi ${nhom} từ ${nhanChucNang(cnCu)} sang ${nhanChucNang(cnMoi)}`;
    return khac.length ? `${dau}; ${khac.join('; ')}` : dau;
  }
  return khac.length ? `${ai} sửa ${nhom}: ${khac.join('; ')}` : `${ai} lưu ${nhom} (không đổi gì)`;
}

function cauNhanVien(ai: string, e: NhatKy, tenNguoiDung: (id: string) => string | null): string {
  const truoc = e.truoc;
  const sau = e.sau;
  const ten = e.tenDoiTuong?.trim() || chuoi(sau, 'tenGoi') || chuoi(truoc, 'tenGoi') || chuoi(sau ?? truoc, 'zaloUid') || '(không tên)';
  const nv = `nhân viên “${ten}”`;
  const tuChoi = obj(sau, 'tuChoi');
  if (!truoc && tuChoi) return `${ai} xác nhận Zalo ${String(tuChoi.zaloUid)} KHÔNG phải ${nv}${chuBangChung(tuChoi)}`;
  if (!truoc && sau) {
    const uids = dsUid(sau);
    const uid = uids.length > 0 ? uids.join(', ') : chuoi(sau, 'zaloUid');
    return `${ai} thêm ${nv}${uid ? ` (Zalo ${uid})` : ''} với vai ${nhanVai(chuoi(sau, 'vai'))}, trạng thái ${nhanTrangThai(chuoi(sau, 'trangThai'))}`;
  }
  if (!truoc || !sau) return `${ai} thay đổi ${nv}`;

  const taiKhoan = (id: string | null) => (id ? (tenNguoiDung(id) ?? '(tài khoản không còn)') : '(không liên kết)');
  const khac: string[] = [];
  if (chuoi(truoc, 'tenGoi') !== chuoi(sau, 'tenGoi')) {
    khac.push(doi('tên gọi', trich(chuoi(truoc, 'tenGoi')), trich(chuoi(sau, 'tenGoi'))));
  }
  if (chuoi(truoc, 'vai') !== chuoi(sau, 'vai')) {
    khac.push(doi('vai', nhanVai(chuoi(truoc, 'vai')), nhanVai(chuoi(sau, 'vai'))));
  }
  if (chuoi(truoc, 'trangThai') !== chuoi(sau, 'trangThai')) {
    khac.push(doi('trạng thái', nhanTrangThai(chuoi(truoc, 'trangThai')), nhanTrangThai(chuoi(sau, 'trangThai'))));
  }
  if ((chuoi(truoc, 'userId') ?? null) !== (chuoi(sau, 'userId') ?? null)) {
    khac.push(doi('tài khoản CRM', taiKhoan(chuoi(truoc, 'userId')), taiKhoan(chuoi(sau, 'userId'))));
  }
  if ((chuoi(truoc, 'ghiChu') ?? '') !== (chuoi(sau, 'ghiChu') ?? '')) {
    khac.push(doi('ghi chú', trich(chuoi(truoc, 'ghiChu')), trich(chuoi(sau, 'ghiChu'))));
  }
  if ((chuoi(truoc, 'soDienThoai') ?? '') !== (chuoi(sau, 'soDienThoai') ?? '')) {
    khac.push(doi('SĐT Zalo', trich(chuoi(truoc, 'soDienThoai')), trich(chuoi(sau, 'soDienThoai'))));
  }
  const xacNhan = obj(sau, 'xacNhan');
  const them = uidThem(truoc, sau);
  if (xacNhan) khac.push(`nối đề xuất Zalo ${String(xacNhan.zaloUid)}${chuBangChung(xacNhan)}`);
  else if (them.length > 0) khac.push(`thêm Zalo ở nick khác ${them.join(', ')}`);
  const bo = uidBo(truoc, sau);
  if (bo.length > 0) khac.push(`gỡ Zalo ${bo.join(', ')}${chuBangChung(obj(sau, 'goUid'))}`);
  return khac.length ? `${ai} đổi ${nv}: ${khac.join('; ')}` : `${ai} lưu ${nv} (không đổi gì)`;
}

/** Dòng hệ thống ghi khi MẶC ĐỊNH nhóm tự đổi (backend ghiNhanDoiMacDinh): "Nhóm “X”: A (mặc định) → B (mặc định) — lý do". */
function cauTuDong(e: NhatKy): string {
  if (e.doiTuong === 'nhan_vien') {
    // Hệ thống tự thêm uid cùng người ở nick khác (docs/77 §8b).
    const ten = e.tenDoiTuong?.trim() || '(không tên)';
    const them = uidThem(e.truoc, e.sau);
    const bo = uidBo(e.truoc, e.sau);
    const phan: string[] = [];
    if (them.length > 0) phan.push(`thêm Zalo ${them.join(', ')}`);
    if (bo.length > 0) phan.push(`chuyển Zalo ${bo.join(', ')} thành đề xuất`);
    const than = `Nhân viên “${ten}”: ${phan.length > 0 ? phan.join('; ') : 'thêm Zalo (không rõ)'}`;
    const lyDo = e.lyDo?.trim();
    return lyDo ? `${than} — ${lyDo}` : than;
  }
  if (e.doiTuong === 'nick_crm') return cauNickCrm('Hệ thống', e);
  const ten = e.tenDoiTuong?.trim() || '(nhóm chưa có tên)';
  const nhan = (a: Anh) => {
    const cn = chuoi(a, 'chucNang');
    return cn === 'sales' || cn === 'khach' ? `${NHAN_MAC_DINH[cn]} (mặc định)` : nhanChucNang(cn);
  };
  const than = `Nhóm “${ten}”: ${nhan(e.truoc)} → ${nhan(e.sau)}`;
  const lyDo = e.lyDo?.trim();
  return lyDo ? `${than} — ${lyDo}` : than;
}

/** Nick CRM nhìn từ nick khác (§8b-an-toàn): sau = {nhinTu, zaloUid, …} · truoc = … (gỡ). */
function cauNickCrm(ai: string, e: NhatKy): string {
  const nick = `nick CRM “${e.tenDoiTuong?.trim() || '(nick không còn)'}”`;
  const uid = chuoi(e.sau, 'zaloUid') ?? chuoi(e.truoc, 'zaloUid') ?? '(không rõ)';
  const sau = e.sau;
  if (sau && sau.tuChoi === true) return `${ai} gỡ Zalo ${uid} khỏi ${nick}`;
  if (!sau) return `${ai} thôi coi Zalo ${uid} là ${nick}`;
  return `${ai} ${e.tuDong ? 'nhận ra' : 'đánh dấu'} Zalo ${uid} là ${nick}${chuBangChung(sau)}`;
}

const NHAN_CHE_DO: Record<string, string> = { tat: 'Tắt', bong: 'Bóng', bat: 'Bật' };

/** Luật thông báo (docs/78 C2): ảnh {loai, dich, cheDo, …}. */
function cauLuatThongBao(ai: string, e: NhatKy): string {
  const loai = chuoi(e.sau, 'loai') ?? chuoi(e.truoc, 'loai') ?? '(không rõ)';
  const luat = `luật thông báo “${loai}”`;
  const cheDo = (a: Anh) => NHAN_CHE_DO[chuoi(a, 'cheDo') ?? ''] ?? chuoi(a, 'cheDo') ?? '?';
  if (!e.truoc && e.sau) return `${ai} tạo ${luat} (${cheDo(e.sau)})`;
  if (e.truoc && !e.sau) return `${ai} xoá ${luat}`;
  if (cheDo(e.truoc) !== cheDo(e.sau)) return `${ai} sửa ${luat} (${cheDo(e.truoc)} → ${cheDo(e.sau)})`;
  return `${ai} sửa ${luat}`;
}

/** Ảnh chụp bản đồ tin bot gửi bằng khoá API (tự rà P1-5): sau = {phienBan, soComposer, them, bo, doi}; null = bị từ chối. */
function cauBanDoTin(ai: string, e: NhatKy): string {
  if (!e.sau) return `${ai} gửi bản đồ tin bị TỪ CHỐI`;
  const ds = (k: string) => {
    const v = e.sau?.[k];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  };
  const phan = [['thêm', ds('them')], ['bỏ', ds('bo')], ['đổi', ds('doi')]]
    .filter(([, v]) => v.length > 0).map(([t, v]) => `${t} ${(v as string[]).join(', ')}`);
  const so = typeof e.sau.soComposer === 'number' ? `: ${e.sau.soComposer} loại tin` : '';
  return `${ai} cập nhật bản đồ tin ${chuoi(e.sau, 'phienBan') ?? ''}${so}${phan.length ? ` — ${phan.join('; ')}` : ''}`;
}

/** Ai thực hiện: user CRM, hoặc tác nhân máy ghi trong ai_id (`api_key:<id>` = bot qua khoá API, `cli:<script>`). */
function tenAi(e: NhatKy): string {
  if (e.aiId.startsWith('api_key:')) return 'Bot (khoá API)';
  if (e.aiId.startsWith('cli:')) return 'Script quản trị';
  return e.ai?.fullName?.trim() || 'Người dùng đã bị xoá';
}

export function cauNhatKy(e: NhatKy, tuy: { tenNguoiDung?: (id: string) => string | null } = {}): string {
  if (e.tuDong) return cauTuDong(e);
  const ai = tenAi(e);
  const than = e.doiTuong === 'nhom'
    ? cauNhom(ai, e)
    : e.doiTuong === 'nhan_vien'
      ? cauNhanVien(ai, e, tuy.tenNguoiDung ?? (() => null))
      : e.doiTuong === 'nick_crm' ? cauNickCrm(ai, e)
        : e.doiTuong === 'luat_thong_bao' ? cauLuatThongBao(ai, e)
          : e.doiTuong === 'ban_do_tin' ? cauBanDoTin(ai, e) : `${ai} thay đổi ${e.doiTuong}`;
  const lyDo = e.lyDo?.trim();
  return lyDo ? `${than} — lý do: ${lyDo}` : than;
}
