// SPDX-License-Identifier: AGPL-3.0-or-later
// Prisma GIẢ dùng chung cho test hàng đợi in / huỷ lệnh in (không phải file test — không
// khớp *.test.ts / *.func.ts). Đánh giá `where` như Postgres (kể cả NULL trong NOT IN) và
// `updateMany` CÓ ĐIỀU KIỆN trả `count` thật — bản giả cũ chỉ có `update` trơn nên không
// bắt được lỗi "ghi đè trạng thái vừa bị huỷ" (hợp đồng v5.1 §8.3).
import { vi } from 'vitest';

type Dong = Record<string, any>;

/** Một dòng có khớp `where` kiểu Prisma không — đủ các dạng hàng đợi + huỷ lệnh in dùng. */
export function khopWhere(j: Dong, w: Dong | undefined): boolean {
  if (!w) return true;
  return Object.entries(w).every(([k, v]) => {
    if (k === 'AND') return (v as Dong[]).every((c) => khopWhere(j, c));
    if (k === 'OR') return (v as Dong[]).some((c) => khopWhere(j, c));
    if (k === 'NOT') return !khopWhere(j, v as Dong);
    const gt = j[k];
    if (v === null) return gt === null || gt === undefined;
    if (v instanceof Date) return gt instanceof Date && gt.getTime() === v.getTime();
    if (typeof v !== 'object') return gt === v;
    return Object.entries(v as Dong).every(([op, x]) => {
      const coGiaTri = gt !== null && gt !== undefined;
      const so = (a: unknown) => (a instanceof Date ? a.getTime() : a) as number;
      switch (op) {
        case 'in': return coGiaTri && (x as unknown[]).includes(gt);
        case 'notIn': return coGiaTri && !(x as unknown[]).includes(gt);
        case 'not': return x === null ? coGiaTri : gt !== x;
        case 'lt': return coGiaTri && so(gt) < so(x);
        case 'lte': return coGiaTri && so(gt) <= so(x);
        case 'gt': return coGiaTri && so(gt) > so(x);
        case 'gte': return coGiaTri && so(gt) >= so(x);
        default: throw new Error(`khopWhere: chưa hỗ trợ ${k}.${op}`);
      }
    });
  });
}

/** Áp `data` của Prisma lên một dòng (kể cả `{ increment }`). */
export function apData(j: Dong, data: Dong): void {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in v) j[k] = (j[k] ?? 0) + v.increment;
    else j[k] = v;
  }
  j.updatedAt = new Date();
}

export interface TuyChonGia {
  /**
   * Gọi NGAY TRƯỚC mỗi `updateMany` (trước khi xét where) — test dùng để mô phỏng một
   * thay đổi đồng thời chen giữa lúc đọc và lúc ghi, vd người quản lý vừa bấm Huỷ.
   */
  truocKhiGhi?: (a: { where: Dong; data: Dong }, hang: Dong[]) => void;
}

/** `updateMany` giả CÓ ĐIỀU KIỆN trên một mảng dòng — gắn vào bản giả sẵn có của từng file test. */
export function updateManyGia(hang: Dong[], tuy: TuyChonGia = {}) {
  return vi.fn(async (a: { where: Dong; data: Dong }) => {
    tuy.truocKhiGhi?.(a, hang);
    let count = 0;
    for (const j of hang) {
      if (!khopWhere(j, a.where)) continue;
      apData(j, a.data);
      count += 1;
    }
    return { count };
  });
}

/** Bản giả đủ bề mặt `printJob` (create/findMany/findFirst/updateMany) trên một mảng dòng. */
export function printJobGia(hang: Dong[], tuy: TuyChonGia = {}) {
  let dem = hang.length;
  const sap = (a: Dong, b: Dong) => (a.createdAt?.getTime?.() ?? 0) - (b.createdAt?.getTime?.() ?? 0);
  return {
    create: vi.fn(async ({ data }: { data: Dong }) => {
      const j = { id: `moi${++dem}`, ippJobId: null, loiCuoi: null, createdAt: new Date(), updatedAt: new Date(), ...data };
      hang.push(j);
      return { ...j };
    }),
    findMany: vi.fn(async (a: { where?: Dong; take?: number } = {}) =>
      hang.filter((j) => khopWhere(j, a.where)).sort(sap).slice(0, a.take ?? Infinity).map((j) => ({ ...j }))),
    findFirst: vi.fn(async (a: { where?: Dong } = {}) => {
      const j = hang.find((x) => khopWhere(x, a.where));
      return j ? { ...j } : null;
    }),
    updateMany: updateManyGia(hang, tuy),
  };
}

/**
 * Dịch vụ hàng đợi RỖNG cho test socket không bàn tới hàng đợi — để registerAgentWs không
 * rơi vào Prisma thật (lần truy vấn đầu dựng Prisma chặn event loop cả trăm ms, làm lệch các
 * test đo thời gian). Cùng tinh thần `layJobTheoId: async () => null` sẵn có.
 */
export function dichVuHangDoiRong() {
  return {
    layHangDoi: vi.fn(async () => ({ choIn: [], chuaXacNhan: [], capNhat: new Date().toISOString() })),
    huyLenhIn: vi.fn(async () => []),
    boTheoDoi: vi.fn(async () => []),
  };
}
