// SPDX-License-Identifier: AGPL-3.0-or-later
// mo-hinh.ts — dựng mô hình bản đồ (khối = composer × đích, đường nối đánh số) từ ảnh chụp danh mục + luật.
// Thuần, không đụng DOM — test ở mo-hinh.spec.ts.
import { HANG, NHOM_HANG, PHA } from './cau-hinh';
import type {
  AnhChupBanDo, CheDo, Composer, DemCanh, Khoi, LienKet, LoaiLienKet, Luat, MaDich, MaHang, MoHinh, NutPhu, TagKhoi,
} from './kieu';

export const idKhoi = (nguon: string, hang: string): string => `${nguon}@${hang}`;
export const idLienKet = (tu: string, den: string): string => `${tu}~${den}`;

const TAG_SOAN: Record<string, TagKhoi> = { ma: 'Mã', model: 'Model', mau: 'Mẫu', anh: 'Ảnh' };

/** Thứ tự hàng từ trên xuống (theo NHOM_HANG). */
export const THU_TU_HANG: MaHang[] = NHOM_HANG.flatMap((n) => n.hang);
const VI_TRI_HANG = Object.fromEntries(THU_TU_HANG.map((h, i) => [h, i])) as Record<string, number>;
const VI_TRI_PHA = Object.fromEntries(PHA.map((p, i) => [p.id, i])) as Record<string, number>;

export const viTriPha = (pha: string): number => VI_TRI_PHA[pha] ?? 0;
export const viTriHang = (hang: string): number => VI_TRI_HANG[hang] ?? 0;

/** Đích hiệu lực của một composer sau khi áp luật (luật `tat` với ban_sao thì không có bản sao). */
export function dichHieuLuc(c: Composer, luat?: Luat): { goc: MaDich[]; banSao: MaDich[]; cheDo: CheDo } {
  if (c.kieu === 'khoa' || !luat) return { goc: [...c.dich_goc], banSao: [], cheDo: c.che_do ?? 'bat' };
  if (c.kieu === 'thuan') return { goc: [...luat.dich], banSao: [], cheDo: luat.che_do };
  // ban_sao: nơi gốc LUÔN giữ (kể cả nếu luật lỡ bỏ — rào phía trình bày, server cũng chặn)
  const banSao = luat.che_do === 'tat' ? [] : luat.dich.filter((d) => !c.dich_goc.includes(d));
  return { goc: [...c.dich_goc], banSao, cheDo: luat.che_do };
}

export function dungMoHinh(anh: AnhChupBanDo): MoHinh {
  const composer: Record<string, Composer> = {};
  const nutPhu: Record<string, NutPhu> = {};
  const khoi: Khoi[] = [];
  const thuTuNguon: Record<string, number> = {};
  /** id nguồn → các khối "gốc" (đích đường nối tới) và khối chính (điểm đi) */
  const khoiGoc: Record<string, string[]> = {};
  const luatTheoLoai: Record<string, Luat> = {};
  for (const l of anh.luat) luatTheoLoai[l.loai] = l;

  let stt = 0;
  const themKhoi = (k: Khoi) => { khoi.push(k); };

  for (const c of anh.composer) {
    composer[c.id] = c;
    thuTuNguon[c.id] = stt++;
    const { goc, banSao, cheDo } = dichHieuLuc(c, luatTheoLoai[c.id]);
    const tagsCo: TagKhoi[] = [TAG_SOAN[c.soan ?? 'ma'] ?? 'Mã'];
    if (c.de_xuat) tagsCo.push('Mới');
    const cheDoGoc: CheDo = c.kieu === 'ban_sao' ? (c.che_do ?? 'bat') : cheDo;
    khoiGoc[c.id] = [];
    for (const d of goc) {
      const tags = [...tagsCo];
      if (cheDoGoc === 'bong') tags.push('Bóng');
      themKhoi({ id: idKhoi(c.id, d), ten: c.ten, pha: c.pha, hang: d, nguon_id: c.id, loai_nut: 'composer', ban_sao: false, che_do: cheDoGoc, tags });
      khoiGoc[c.id].push(idKhoi(c.id, d));
    }
    for (const d of banSao) {
      const tags = [...tagsCo];
      if (cheDo === 'bong') tags.push('Bóng');
      themKhoi({ id: idKhoi(c.id, d), ten: c.ten, pha: c.pha, hang: d, nguon_id: c.id, loai_nut: 'composer', ban_sao: true, che_do: cheDo, tags });
    }
  }
  for (const n of [...anh.nguon, ...anh.crm]) {
    nutPhu[n.id] = n;
    thuTuNguon[n.id] = stt++;
    const laNguon = anh.nguon.includes(n);
    themKhoi({ id: idKhoi(n.id, n.hang), ten: n.ten, pha: n.pha, hang: n.hang, nguon_id: n.id, loai_nut: laNguon ? 'nguon' : 'crm', ban_sao: false, che_do: 'bat', tags: [laNguon ? 'Nguồn' : 'CRM'] });
    khoiGoc[n.id] = [idKhoi(n.id, n.hang)];
  }

  // Thứ tự khối: cột → hàng → thứ tự trong danh mục (quyết số thứ tự liên kết và vị trí xếp chồng trong ô)
  khoi.sort((a, b) =>
    viTriPha(a.pha) - viTriPha(b.pha) || viTriHang(a.hang) - viTriHang(b.hang) || thuTuNguon[a.nguon_id] - thuTuNguon[b.nguon_id]);
  const khoiTheoId: Record<string, Khoi> = Object.fromEntries(khoi.map((k) => [k.id, k]));
  const thuTuKhoi: Record<string, number> = Object.fromEntries(khoi.map((k, i) => [k.id, i]));

  const dem: Record<string, DemCanh> = Object.fromEntries(anh.dem_7_ngay.map((d) => [d.canh_id, d]));
  const tho: Omit<LienKet, 'so'>[] = [];
  const daCo = new Set<string>();
  const them = (tu: string, den: string, loai: LoaiLienKet, vi_sao: string) => {
    if (tu === den || !khoiTheoId[tu] || !khoiTheoId[den]) return;
    const id = idLienKet(tu, den);
    if (daCo.has(id)) return;
    daCo.add(id);
    tho.push({ id, tu, den, loai, vi_sao, dem: dem[id] });
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
    if (tu) them(tu, k.id, 'ban_sao', `Luật: gửi thêm bản sao tới ${HANG[k.hang].ten}${k.che_do === 'bong' ? ' (chạy bóng)' : ''}`);
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

  return { pha: PHA, nhom: NHOM_HANG, hang: HANG, khoi, khoiTheoId, lienKet, lienKetTheoId, vao, ra, composer, nutPhu, demKhoi };
}

/** Tổng số liên kết theo loại — số ở chú giải. */
export function demTheoLoai(lienKet: LienKet[]): Record<LoaiLienKet, number> {
  const r: Record<LoaiLienKet, number> = { nghiep_vu: 0, ban_sao: 0, nguon: 0, vong: 0, chan: 0, crm: 0 };
  for (const l of lienKet) r[l.loai]++;
  return r;
}
