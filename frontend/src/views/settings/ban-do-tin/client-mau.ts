// SPDX-License-Identifier: AGPL-3.0-or-later
// client-mau.ts — adapter GIẢ LẬP cho `BanDoTinClient` (chưa có backend; nhánh feat/ban-do-tin đang dựng).
// Giữ luật + nhật ký trong bộ nhớ; kiểm luật bằng đúng hàm `kiemLuat` (tương đương rào server).
import type { BanDoTinClient, LuuLuatNhap } from '@/api/ban-do-tin';
import { anhChupMau, soGia } from './danh-muc-mau';
import type { AnhChupBanDo, DemCanh, DongNhatKy, Luat } from './kieu';
import { kiemLuat } from './luat';
import { dungMoHinh } from './mo-hinh';
import { TEN_DICH } from './cau-hinh';

/** Số đếm 7 ngày giả, tất định, cho mọi cạnh và mọi khối. */
export function demMau(anh: AnhChupBanDo): DemCanh[] {
  const mh = dungMoHinh({ ...anh, dem_7_ngay: [] });
  const dem: DemCanh[] = [];
  for (const l of mh.lienKet) {
    const so = 3 + soGia(l.id, 140);
    dem.push({ canh_id: l.id, so, chan: l.loai === 'chan' ? Math.round(so / 3) : 0, bong: 0 });
  }
  for (const k of mh.khoi) {
    const bong = k.che_do === 'bong';
    const so = bong ? 0 : 5 + soGia(k.id, 300);
    const b = bong ? 6 + soGia(`b${k.id}`, 120) : 0;
    dem.push({ canh_id: `gui:${k.id}`, so, chan: soGia(`c${k.id}`, 4), bong: b, bong_24h: bong ? Math.max(1, Math.round(b / 7)) : 0 });
  }
  return dem;
}

export function taoClientMau(tre = 0): BanDoTinClient {
  const goc = anhChupMau();
  let luat: Luat[] = goc.luat;
  const nhatKy: DongNhatKy[] = [...goc.nhat_ky];
  let phienBan = goc.phien_ban;
  const cho = () => (tre ? new Promise((r) => setTimeout(r, tre)) : Promise.resolve());

  const anh = (): AnhChupBanDo => {
    const a: AnhChupBanDo = { ...goc, phien_ban: phienBan, luat: luat.map((l) => ({ ...l, dich: [...l.dich] })), nhat_ky: [...nhatKy] };
    a.dem_7_ngay = demMau(a);
    return a;
  };

  return {
    laMau: true,
    coGuiThu: false,
    async layAnhChup() { await cho(); return anh(); },
    async luuLuat(nhap: LuuLuatNhap) {
      await cho();
      const c = goc.composer.find((x) => x.id === nhap.loai);
      if (!c) throw new Error('Không có loại tin này.');
      const kq = kiemLuat(c, nhap.dich, nhap.che_do);
      if (!kq.hopLe) throw new Error(kq.loi.join(' '));
      const cu = luat.find((l) => l.loai === nhap.loai);
      if (cu && nhap.phien_ban != null && cu.phien_ban !== nhap.phien_ban) throw new Error('Luật vừa được người khác sửa — tải lại trang.');
      const moi: Luat = {
        id: cu?.id ?? `luat-${luat.length + 1}`, loai: nhap.loai, dich: [...nhap.dich], che_do: nhap.che_do,
        phien_ban: (cu?.phien_ban ?? 0) + 1, nguoi_sua: 'Bạn', luc: new Date().toISOString(),
      };
      luat = [...luat.filter((l) => l.loai !== nhap.loai), moi];
      phienBan++;
      const truoc = new Set(cu?.dich ?? c.dich_goc);
      const sau = new Set(nhap.dich);
      const doi = [
        ...[...sau].filter((d) => !truoc.has(d)).map((d) => `thêm ${TEN_DICH(d)}`),
        ...[...truoc].filter((d) => !sau.has(d)).map((d) => `bỏ ${TEN_DICH(d)}`),
      ];
      if ((cu?.che_do ?? c.che_do ?? 'bat') !== nhap.che_do) doi.push(`chế độ ${nhap.che_do}`);
      const dong: DongNhatKy = { luc: moi.luc!, nguoi: 'Bạn', noi_dung: `${c.ten}: ${doi.join(', ') || 'lưu lại'}${nhap.ly_do ? ` — ${nhap.ly_do}` : ''}` };
      nhatKy.unshift(dong);
      return { luat: moi, nhat_ky: dong };
    },
    async xoaLuat(loai: string) {
      await cho();
      const c = goc.composer.find((x) => x.id === loai);
      if (!luat.some((l) => l.loai === loai)) return null;
      luat = luat.filter((l) => l.loai !== loai);
      phienBan++;
      const dong: DongNhatKy = { luc: new Date().toISOString(), nguoi: 'Bạn', noi_dung: `${c?.ten ?? loai}: hoàn lại như mã` };
      nhatKy.unshift(dong);
      return dong;
    },
    async guiThu() { throw new Error('Gửi thử cần backend (docs/78 C2) — chưa nối.'); },
  };
}
