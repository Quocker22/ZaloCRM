// SPDX-License-Identifier: AGPL-3.0-or-later
// may-in-nhat-ky-app.ts — hàm THUẦN cho thẻ "Log app" trong mục Nhật ký máy in
// (PrintAgentAppLogPanel.vue): khoảng lọc, gộp dòng mới khi tự làm mới, con trỏ đuôi,
// nhóm sự kiện một chạm, chọn thẻ lúc mở trang.
//
// Không đụng Vue/DOM/axios để test được bằng vitest môi trường node
// (may-in-nhat-ky-app.spec.ts). Giờ theo GIỜ VIỆT NAM như may-in-nhat-ky.ts.
import { khoangThoiGian } from './may-in-nhat-ky';

const PHUT_MS = 60_000;
const GIO_MS = 60 * PHUT_MS;

// ── Khoảng thời gian ────────────────────────────────────────────────────────

export type KhoangNhatKyApp = '1_gio' | 'hom_nay' | '24_gio' | '7_ngay' | '30_ngay';

export const LUA_CHON_KHOANG_APP: ReadonlyArray<{ value: KhoangNhatKyApp; title: string }> = [
  { value: '1_gio', title: '1 giờ' },
  { value: 'hom_nay', title: 'Hôm nay' },
  { value: '24_gio', title: '24 giờ' },
  { value: '7_ngay', title: '7 ngày' },
  { value: '30_ngay', title: '30 ngày' },
];

/**
 * `tu`/`den` gửi API nhật ký app.
 *   - "1 giờ", "24 giờ" = khoảng CUỐN tính từ bây giờ: chỉ gửi `tu`; không gửi `den` để
 *     máy chủ lấy trần "bây giờ + 1 ngày" — máy tính shop chạy nhanh giờ vài phút thì dòng
 *     mới nhất vẫn hiện. `cuon: true` = khoảng không đổi theo ngày lịch.
 *   - "Hôm nay", "7 ngày", "30 ngày" = ngày LỊCH giờ VN, dùng lại `khoangThoiGian`.
 */
export function khoangNhatKyApp(
  chon: KhoangNhatKyApp,
  bayGio: number = Date.now(),
): { tu: string; den?: string; cuon: boolean } {
  if (chon === '1_gio') return { tu: new Date(bayGio - GIO_MS).toISOString(), cuon: true };
  if (chon === '24_gio') return { tu: new Date(bayGio - 24 * GIO_MS).toISOString(), cuon: true };
  return { ...khoangThoiGian(chon, bayGio), cuon: false };
}

// ── Nhóm sự kiện một chạm ───────────────────────────────────────────────────

export interface NhomSuKien {
  value: string;
  title: string;
  /** Mã gửi API (`suKien`, phẩy). Rỗng = mọi sự kiện. */
  ma: readonly string[];
}

export const NHOM_SU_KIEN_APP: ReadonlyArray<NhomSuKien> = [
  { value: 'vet_in', title: 'Vết in', ma: ['vet_in'] },
  { value: 'usb_doc', title: 'Đọc USB', ma: ['usb_doc'] },
  { value: 'usb_khay', title: 'Khay USB', ma: ['usb_khay'] },
  { value: 'ket_qua', title: 'Kết quả', ma: ['ket_qua'] },
  { value: 'su_co', title: 'Sự cố', ma: ['su_co'] },
  { value: 'trang_thai_may_in', title: 'Trạng thái máy in', ma: ['trang_thai_may_in'] },
  { value: 'nhan_job', title: 'Nhận lệnh', ma: ['nhan_job'] },
  { value: 'ket_noi', title: 'Kết nối', ma: ['ket_noi', 'mat_ket_noi'] },
  { value: 'tat_ca', title: 'Tất cả', ma: [] },
];

/** Giá trị `suKien` gửi API cho một nhóm; "Tất cả"/lạ → undefined (không lọc). */
export function suKienCuaNhom(nhom: string): string | undefined {
  const n = NHOM_SU_KIEN_APP.find((x) => x.value === nhom);
  return n && n.ma.length > 0 ? n.ma.join(',') : undefined;
}

// ── Danh sách: thứ tự, gộp dòng mới, con trỏ ────────────────────────────────

export interface DongCoMoc {
  id: string;
  /** ISO `toISOString()` — cùng độ dài nên so chuỗi = so thời gian. */
  luc: string;
}

/** Con trỏ API "<ISO>|<id>" của một dòng. */
export function conTroCua(d: DongCoMoc): string {
  return `${d.luc}|${d.id}`;
}

/** Mới nhất trước — cùng thứ tự máy chủ (luc DESC, id DESC). */
function moiTruoc(a: DongCoMoc, b: DongCoMoc): number {
  if (a.luc !== b.luc) return a.luc < b.luc ? 1 : -1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

/**
 * Gộp các dòng mới (lượt tự làm mới, `sau`) vào danh sách đang xem: bỏ trùng id, xếp lại
 * mới nhất trước — dòng đến TRỄ (máy khác gửi chậm vài giây) vào đúng chỗ theo giờ chứ
 * không nằm chỏng chơ trên đầu. Quá `tran` dòng thì bỏ bớt dòng CŨ nhất; `catDuoi: true`
 * báo người gọi đặt lại con trỏ "Tải thêm" từ dòng cuối còn giữ.
 */
export function gopDongMoi<T extends DongCoMoc>(
  cu: readonly T[],
  moi: readonly T[],
  tran = 5000,
): { ds: T[]; catDuoi: boolean } {
  const daCo = new Set(cu.map((d) => d.id));
  const them = moi.filter((d) => !daCo.has(d.id));
  if (them.length === 0) return { ds: [...cu], catDuoi: false };
  const ds = [...cu, ...them].sort(moiTruoc);
  if (ds.length <= tran) return { ds, catDuoi: false };
  return { ds: ds.slice(0, tran), catDuoi: true };
}

/**
 * Con trỏ `sau` cho lượt tự làm mới — CỐ Ý lùi lại một đoạn thay vì lấy dòng mới nhất:
 * nhiều máy in gửi lô theo nhịp riêng, dòng của máy B có thể tới SAU dòng mới hơn của
 * máy A. Lấy đúng dòng mới nhất thì dòng tới trễ của B không bao giờ hiện (phải bấm tải
 * lại). Lùi `msChong` (mặc định 2 phút) nhưng không quá `toiDaLui` dòng — trùng lặp thì
 * `gopDongMoi` bỏ theo id. Danh sách rỗng → null (tải trang đầu).
 */
export function conTroDuoi(ds: readonly DongCoMoc[], msChong = 2 * PHUT_MS, toiDaLui = 200): string | null {
  if (ds.length === 0) return null;
  const moc = new Date(ds[0].luc).getTime() - msChong;
  const tran = Math.min(ds.length - 1, toiDaLui);
  let i = 0;
  while (i < tran && new Date(ds[i].luc).getTime() > moc) i++;
  return conTroCua(ds[i]);
}

// ── Chọn thẻ Hàng đợi in / Đã in / Đã huỷ / Nhật ký in / Log app ────────────

/** `da_in` / `da_huy` (26/09): lịch sử 30 ngày cạnh "Hàng đợi in" (PrintAgentHistoryPanel). */
export type TabNhatKy = 'hang_doi' | 'da_in' | 'da_huy' | 'in' | 'app';

const CAC_TAB: readonly TabNhatKy[] = ['hang_doi', 'da_in', 'da_huy', 'in', 'app'];

export const laTabNhatKy = (x: unknown): x is TabNhatKy => CAC_TAB.includes(x as TabNhatKy);

/**
 * Thẻ mở sẵn (hợp đồng hàng đợi/huỷ §6.1):
 *   1. URL `?nhatKy=hang_doi|da_in|da_huy|in|app` — người mở link chọn rõ ràng, luôn thắng;
 *   2. có hoá đơn TẠM GIỮ (máy in đang lỗi) → "Hàng đợi in", BẤT KỂ thẻ đã nhớ: đang sự cố hết
 *      giấy thì việc đầu tiên là thấy các hoá đơn đang chờ (bản 5438b68 đã nhớ in/app cho mọi
 *      người — không được để nó che hàng đợi lúc sự cố);
 *   3. thẻ người dùng đã chọn (localStorage) — chỉ khi không có gì tạm giữ;
 *   4. còn lại: "Hàng đợi in" nếu có lệnh đang chờ in, ngược lại "Nhật ký in".
 */
export function chonTabNhatKy(tuUrl: unknown, daLuu: unknown, soChoIn = 0, coTamGiu = false): TabNhatKy {
  if (laTabNhatKy(tuUrl)) return tuUrl;
  if (coTamGiu) return 'hang_doi';
  if (laTabNhatKy(daLuu)) return daLuu;
  return soChoIn > 0 ? 'hang_doi' : 'in';
}
