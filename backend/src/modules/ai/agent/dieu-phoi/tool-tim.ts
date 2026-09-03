// SPDX-License-Identifier: AGPL-3.0-or-later
// TOOL TÌM (chỉ đọc) cho con điều phối CẦM LÁI — trả JSON CÓ ID, và ghi mọi
// kết quả vào BẰNG CHỨNG của phiên.
//
// Vì sao không dùng bộ tool kiểm chứng cũ (dinhDangKhachHang/dinhDangSanPham):
// chúng trả CHỮ cho người đọc; con cầm lái cần id để điền vào object, và code
// cần một danh sách id tất định để KIỂM model không bịa. Bằng chứng tích luỹ
// qua các lượt: NV trả lời "3" ở lượt sau thì model đối chiếu với danh sách
// đã tra ở lượt trước — không cần tra lại, không cần code đọc chữ "3".
import type { OdooClient } from '../../odoo/client.js';
import { traKhachHang } from '../../odoo/tools/tra-khach-hang.js';
import { traSanPham, type SanPhamList } from '../../odoo/tools/tra-san-pham.js';
import type { ToolKiemChung } from '../harness/vong-kiem-chung.js';
import type { PhienDon } from './phien-don.js';

export type BangChungPhien = NonNullable<PhienDon['bangChung']>;

export const bangChungTrong = (): BangChungPhien => ({ khach: [], sp: [] });

/** Gộp ứng viên vào bằng chứng, không trùng id, giữ tối đa 60 mỗi loại (phiên 30'). */
export function themBangChungKhach(bc: BangChungPhien, ds: BangChungPhien['khach']): void {
  for (const k of ds) if (!bc.khach.some((x) => x.id === k.id)) bc.khach.push(k);
  if (bc.khach.length > 60) bc.khach.splice(0, bc.khach.length - 60);
}
export function themBangChungSp(bc: BangChungPhien, ds: BangChungPhien['sp']): void {
  for (const s of ds) if (!bc.sp.some((x) => x.id === s.id)) bc.sp.push(s);
  if (bc.sp.length > 60) bc.sp.splice(0, bc.sp.length - 60);
}

export interface OdooTim {
  odoo: Pick<OdooClient, 'searchRead' | 'execute'>;
}

/** Kết quả tim_khach dạng dữ liệu — dùng chung cho tool (model) và code (tra bù). */
export async function timKhach(deps: OdooTim, input: { ten?: string; sdt?: string; ma?: string }): Promise<{
  ketQua: 'mot' | 'nhieu' | 'khong';
  khach: BangChungPhien['khach'];
  conNua: boolean;
  goiY?: number;
}> {
  const kq = await traKhachHang({ odoo: deps.odoo }, input);
  if (kq.trangThai === 'tim_thay') {
    return { ketQua: 'mot', khach: [{ id: kq.khach.id, ten: kq.khach.ten, ma: kq.khach.ma, sdt: kq.khach.dienThoai }], conNua: false };
  }
  if (kq.trangThai === 'khong_thay') return { ketQua: 'khong', khach: [], conNua: false };
  return {
    ketQua: 'nhieu',
    khach: kq.danhSach.map((k) => ({ id: k.id, ten: k.ten, ma: k.ma, sdt: k.dienThoai })),
    conNua: kq.conNua === true,
    ...(kq.tuChot ? { goiY: kq.tuChot.id } : {}),
  };
}

export async function timSp(deps: OdooTim, input: { ten: string; gioi_han?: number }): Promise<{
  sp: BangChungPhien['sp'];
  ganDung: boolean;
  conNua: boolean;
}> {
  const l = (await traSanPham({ odoo: deps.odoo }, input)) as SanPhamList;
  return {
    sp: l.map((s) => ({ id: s.id, ten: s.ten, gia: s.gia, donVi: s.donVi })),
    ganDung: l.ganDung === true || l.daNoiRong === true,
    conNua: (l.tongKhop ?? l.length) > l.length,
  };
}

export interface HamTim {
  khach: (input: { ten?: string; sdt?: string; ma?: string }) => ReturnType<typeof timKhach>;
  sp: (input: { ten: string; gioi_han?: number }) => ReturnType<typeof timSp>;
}
export const hamTimOdoo = (deps: OdooTim): HamTim => ({ khach: (i) => timKhach(deps, i), sp: (i) => timSp(deps, i) });

/** Bộ tool cho model — mỗi lần gọi đều đổ kết quả vào `bc`. */
export function boToolTim(tim: HamTim, bc: BangChungPhien): ToolKiemChung[] {
  return [
    {
      definition: {
        name: 'tim_khach',
        description:
          'Tìm khách trên Odoo theo tên / SĐT / mã KH. Trả JSON có id. Kết quả nhiều người → để khach.id trống, ' +
          'code sẽ hỏi NV chọn; NV chọn xong (số thứ tự, tên, SĐT) thì lượt sau điền đúng id trong danh sách này.',
        inputSchema: {
          type: 'object',
          properties: { ten: { type: 'string' }, sdt: { type: 'string' }, ma: { type: 'string' } },
          required: [],
        },
      },
      run: async (input) => {
        const i = input as { ten?: string; sdt?: string; ma?: string };
        const r = await tim.khach(i);
        themBangChungKhach(bc, r.khach);
        bc.traKhachCuoi = { hoi: i.ten ?? i.sdt ?? i.ma ?? '', ds: r.khach, conNua: r.conNua, ...(r.goiY ? { goiY: r.goiY } : {}) };
        return JSON.stringify({
          ket_qua: r.ketQua, con_nua: r.conNua, ...(r.goiY ? { goi_y_id: r.goiY } : {}),
          khach: r.khach.slice(0, 12).map((k) => ({ id: k.id, ten: k.ten, ma: k.ma ?? undefined, sdt: k.sdt ?? undefined })),
        });
      },
    },
    {
      definition: {
        name: 'tim_sp',
        description:
          'Tìm sản phẩm trên Odoo theo tên NV gõ (giữ nguyên văn, kể cả viết tắt/sai chính tả). Trả JSON có id, giá hệ ' +
          'thống (gia=0 là chưa có giá). gan_dung=true = kết quả đoán, phải để NV chọn. Đúng MỘT kết quả không gần đúng ' +
          '→ điền spId. Nhiều kết quả → để spId trống trừ khi tin NV đã nói rõ loại nào (vd "đầu trong").',
        inputSchema: {
          type: 'object',
          properties: { ten: { type: 'string' }, gioi_han: { type: 'integer' } },
          required: ['ten'],
        },
      },
      run: async (input) => {
        const i = input as { ten: string; gioi_han?: number };
        const r = await tim.sp(i);
        themBangChungSp(bc, r.sp);
        return JSON.stringify({
          gan_dung: r.ganDung, con_nua: r.conNua,
          sp: r.sp.slice(0, 12).map((s) => ({ id: s.id, ten: s.ten, gia: s.gia, don_vi: s.donVi ?? undefined })),
        });
      },
    },
  ];
}

/** Bằng chứng dạng chữ cho prompt — để model thấy id các lượt trước. */
export function tomTatBangChungPhien(bc: BangChungPhien): string {
  const k = bc.khach.slice(-12).map((x) => `  KH id=${x.id} "${x.ten}"${x.ma ? ` mã ${x.ma}` : ''}${x.sdt ? ` ${x.sdt}` : ''}`);
  const s = bc.sp.slice(-24).map((x) => `  SP id=${x.id} "${x.ten}" giá ${x.gia}${x.donVi ? `/${x.donVi}` : ''}`);
  if (k.length === 0 && s.length === 0) return '';
  return ['ĐÃ TRA ĐƯỢC (id hợp lệ để điền):', ...k, ...s].join('\n');
}
