// SPDX-License-Identifier: AGPL-3.0-or-later
// mo-hinh.ts — dựng mô hình bản đồ (khối = composer × đích, đường nối đánh số) từ ảnh chụp danh mục + luật.
// Thuần, không đụng DOM — test ở mo-hinh.spec.ts.
import { HANG, HANG_AN_KHI_TRONG, NHOM_HANG, PHA } from './cau-hinh';
import type {
  AnhChupBanDo, CheDo, Composer, DemCanh, Khoi, LienKet, LoaiLienKet, Luat, MaDich, MaHang, MoHinh, NhomHang, NutPhu, TagKhoi,
} from './kieu';

export const idKhoi = (nguon: string, hang: string): string => `${nguon}@${hang}`;
export const idLienKet = (tu: string, den: string): string => `${tu}~${den}`;

/** Thứ tự hàng từ trên xuống (theo NHOM_HANG). */
export const THU_TU_HANG: MaHang[] = NHOM_HANG.flatMap((n) => n.hang);
const VI_TRI_HANG = Object.fromEntries(THU_TU_HANG.map((h, i) => [h, i])) as Record<string, number>;
const VI_TRI_PHA = Object.fromEntries(PHA.map((p, i) => [p.id, i])) as Record<string, number>;

export const viTriPha = (pha: string): number => VI_TRI_PHA[pha] ?? 0;
export const viTriHang = (hang: string): number => VI_TRI_HANG[hang] ?? 0;

/**
 * Đích hiệu lực của một composer sau khi áp luật CRM. Nơi gốc (`dich_goc`) LUÔN gửi như mã — luật chỉ THÊM bản sao
 * (CRM cấm `nhom_goc` làm đích, hợp đồng §2). 🔒 không có bản sao; luật `tat` ⇒ không bản sao.
 */
export function dichHieuLuc(c: Composer, luat?: Luat): { goc: MaDich[]; banSao: MaDich[]; cheDo: CheDo } {
  if (c.kieu === 'khoa' || !luat) return { goc: [...c.dich_goc], banSao: [], cheDo: 'bat' };
  const banSao = luat.che_do === 'tat' ? [] : luat.dich.filter((d) => !c.dich_goc.includes(d));
  return { goc: [...c.dich_goc], banSao, cheDo: luat.che_do };
}

export function dungMoHinh(anh: AnhChupBanDo): MoHinh {
  const composer: Record<string, Composer> = {};
  const nutPhu: Record<string, NutPhu> = {};
  const khoi: Khoi[] = [];
  const thuTuNguon: Record<string, number> = {};
  /** id nguồn → các khối "gốc" (đích đường nối tới; khối đầu là điểm đi) */
  const khoiGoc: Record<string, string[]> = {};
  const luatTheoLoai: Record<string, Luat> = {};
  for (const l of anh.luat) luatTheoLoai[l.loai] = l;

  let stt = 0;
  for (const c of anh.composer) {
    composer[c.id] = c;
    thuTuNguon[c.id] = stt++;
    const { goc, banSao, cheDo } = dichHieuLuc(c, luatTheoLoai[c.id]);
    // 'Khoá' KHÔNG gắn trên sơ đồ: đa số tin là 🔒 nên nhãn đó chỉ thành nhiễu — panel nói rõ "🔒 đích cố định".
    const tagsCo: TagKhoi[] = [];
    if (c.de_xuat) tagsCo.push('Mới');
    if (c.nhay_cam.length) tagsCo.push('Nhạy cảm');
    khoiGoc[c.id] = [];
    for (const d of goc) {
      khoi.push({ id: idKhoi(c.id, d), ten: c.ten, pha: c.pha, hang: d, nguon_id: c.id, loai_nut: 'composer', ban_sao: false, che_do: 'bat', tags: [...tagsCo] });
      khoiGoc[c.id].push(idKhoi(c.id, d));
    }
    for (const d of banSao) {
      const tags: TagKhoi[] = cheDo === 'bong' ? ['Bóng', ...tagsCo] : [...tagsCo];
      khoi.push({ id: idKhoi(c.id, d), ten: c.ten, pha: c.pha, hang: d, nguon_id: c.id, loai_nut: 'composer', ban_sao: true, che_do: cheDo, tags });
    }
  }
  for (const n of [...anh.nguon, ...anh.crm]) {
    if (khoiGoc[n.id]) continue; // id trùng composer — composer thắng
    nutPhu[n.id] = n;
    thuTuNguon[n.id] = stt++;
    const laCrm = !!n.crm;
    const tat = laCrm && !n.crm!.bat;
    khoi.push({
      id: idKhoi(n.id, n.hang), ten: n.ten, pha: n.pha, hang: n.hang, nguon_id: n.id, loai_nut: laCrm ? 'crm' : 'nguon',
      ban_sao: false, che_do: tat ? 'tat' : 'bat', tags: [laCrm ? 'CRM' : 'Nguồn', ...(tat ? ['Tắt' as const] : [])],
    });
    khoiGoc[n.id] = [idKhoi(n.id, n.hang)];
  }

  // Thứ tự khối: cột → hàng → thứ tự trong danh mục (quyết số thứ tự liên kết và vị trí xếp chồng trong ô)
  khoi.sort((a, b) =>
    viTriPha(a.pha) - viTriPha(b.pha) || viTriHang(a.hang) - viTriHang(b.hang) || thuTuNguon[a.nguon_id] - thuTuNguon[b.nguon_id]);
  const khoiTheoId: Record<string, Khoi> = Object.fromEntries(khoi.map((k) => [k.id, k]));
  const thuTuKhoi: Record<string, number> = Object.fromEntries(khoi.map((k, i) => [k.id, i]));

  const dem: Record<string, DemCanh> = Object.fromEntries(anh.dem.map((d) => [d.canh_id, d]));
  const tho: Omit<LienKet, 'so'>[] = [];
  const daCo = new Set<string>();
  const them = (tu: string, den: string, loai: LoaiLienKet, vi_sao: string) => {
    if (tu === den || !khoiTheoId[tu] || !khoiTheoId[den]) return;
    const id = idLienKet(tu, den);
    if (daCo.has(id)) return;
    daCo.add(id);
    tho.push({ id, tu, den, loai, vi_sao, ...(loai === 'ban_sao' && dem[`luat:${den}`] ? { dem: dem[`luat:${den}`] } : {}) });
  };

  const nguonCanh: { id: string; dan_toi: { den: string; kieu: LoaiLienKet; vi_sao?: string }[] }[] = [
    ...anh.composer, ...anh.nguon, ...anh.crm,
  ];
  for (const n of nguonCanh) {
    const tu = khoiGoc[n.id]?.[0];
    if (!tu) continue;
    for (const c of n.dan_toi) for (const den of khoiGoc[c.den] ?? []) them(tu, den, c.kieu, c.vi_sao ?? '');
  }
  for (const k of khoi) {
    if (!k.ban_sao) continue;
    const tu = khoiGoc[k.nguon_id]?.[0];
    if (tu) them(tu, k.id, 'ban_sao', `Luật CRM: gửi thêm bản sao tới ${HANG[k.hang].ten}${k.che_do === 'bong' ? ' (chạy bóng — ghi sổ, chưa gửi)' : ''}`);
  }

  tho.sort((a, b) => thuTuKhoi[a.tu] - thuTuKhoi[b.tu] || thuTuKhoi[a.den] - thuTuKhoi[b.den]);
  const lienKet: LienKet[] = tho.map((l, i) => ({ ...l, so: i + 1 }));
  const lienKetTheoId = Object.fromEntries(lienKet.map((l) => [l.id, l]));
  const vao: Record<string, LienKet[]> = {};
  const ra: Record<string, LienKet[]> = {};
  for (const k of khoi) { vao[k.id] = []; ra[k.id] = []; }
  for (const l of lienKet) { ra[l.tu].push(l); vao[l.den].push(l); }

  const demKhoi: Record<string, DemCanh> = {};
  for (const k of khoi) if (dem[`gui:${k.id}`]) demKhoi[k.id] = dem[`gui:${k.id}`];

  const coHang = new Set<string>(khoi.map((k) => k.hang));
  const nhom: NhomHang[] = NHOM_HANG.map((g) => ({ ...g, hang: g.hang.filter((h) => !HANG_AN_KHI_TRONG.has(h) || coHang.has(h)) }))
    .filter((g) => g.hang.length > 0);

  return { pha: PHA, nhom, hang: HANG, khoi, khoiTheoId, lienKet, lienKetTheoId, vao, ra, composer, nutPhu, demKhoi };
}

/** Tổng số liên kết theo loại — số ở chú giải. */
export function demTheoLoai(lienKet: LienKet[]): Record<LoaiLienKet, number> {
  const r: Record<LoaiLienKet, number> = { nghiep_vu: 0, hoi_lai: 0, su_kien: 0, chan: 0, ban_sao: 0, crm: 0 };
  for (const l of lienKet) r[l.loai]++;
  return r;
}
