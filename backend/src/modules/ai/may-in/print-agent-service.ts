// SPDX-License-Identifier: AGPL-3.0-or-later
// print-agent-service.ts — Task 6 (nhiều máy in theo chi nhánh): CRUD máy in
// cho admin ZaloCRM. Đây là mặt bàn admin dùng để GEN TOKEN rồi dán vào app
// Rust (print-agent-rs) — token sinh ra ở đây chính là danh tính của agent-ws
// (Task 4, agent-registry theo token) và của cron chọn máy (Task 5).
//
// VÌ SAO token chỉ trả về LÚC TẠO: từ giờ về sau print_agents.token là bí mật
// (ai cầm token là mạo danh được máy in đó, gửi/nhận job của org). List chỉ lộ
// 4 ký tự cuối — đủ để admin phân biệt "máy nào là máy nào" khi debug qua điện
// thoại ("đọc anh 4 số cuối xem"), không đủ để đoán lại token.
//
// VÌ SAO transaction cho laMacDinh: 2 request PUT/POST đặt laMacDinh=true gần
// như đồng thời (2 tab admin) không được để lại 2 dòng cùng laMacDinh=true —
// chonMayIn (Task 2) tầng 3 lấy máy mặc định bằng `.find(laMacDinh)`, có 2 dòng
// thì lấy dòng đầu do thứ tự Postgres trả về — KHÔNG XÁC ĐỊNH, dễ đổi máy đích
// âm thầm sau một lần restart process. Đưa "bỏ mặc định máy khác" + "ghi dòng
// mới/cập nhật" vào cùng $transaction để không có khe hở giữa hai câu lệnh.
import { randomBytes } from 'node:crypto';
import { prisma } from '../../../shared/database/prisma-client.js';
import { agentRegistry } from './agent-registry.js';
import { nhanCua } from './nhat-ky.js';
import { KHO } from '../agent/noi-zalo/gom-don/kieu.js';
import type { PrintAgent } from '@prisma/client';

export interface TaoMayInInput {
  orgId: string;
  ten: string;
  warehouseIds: number[];
  laMacDinh?: boolean;
}

export interface SuaMayInInput {
  ten?: string;
  warehouseIds?: number[];
  laMacDinh?: boolean;
}

/** Dòng máy in AN TOÀN để trả ra ngoài (list) — token đã cắt, chỉ còn 4 ký tự cuối. */
export interface MayInAnToan {
  id: string;
  orgId: string;
  ten: string;
  tokenDuoi: string;
  warehouseIds: number[];
  laMacDinh: boolean;
  online: boolean;
  /**
   * Tình trạng máy in app vừa báo (hết giấy, kẹt giấy…); null = chưa biết
   * hoặc app offline. Hợp đồng §3.4.
   */
  tinhTrang: { ma: string; nhan: string; luc: Date } | null;
  createdAt: Date;
  updatedAt: Date;
}

function tokenDuoiCua(token: string): string {
  return token.slice(-4);
}

function tinhTrangCua(token: string): MayInAnToan['tinhTrang'] {
  const tt = agentRegistry.layTinhTrang(token);
  return tt ? { ma: tt.ma, nhan: nhanCua(tt.ma), luc: tt.luc } : null;
}

function toAnToan(row: PrintAgent): MayInAnToan {
  return {
    id: row.id,
    orgId: row.orgId,
    ten: row.ten,
    tokenDuoi: tokenDuoiCua(row.token),
    warehouseIds: row.warehouseIds,
    laMacDinh: row.laMacDinh,
    online: agentRegistry.coAgent(row.token),
    tinhTrang: tinhTrangCua(row.token),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Lỗi máy in không thuộc org gọi (guard đa-tenant) hoặc không tồn tại. */
export class MayInKhongTimThay extends Error {
  constructor(id: string) {
    super(`không tìm thấy máy in ${id} thuộc org này`);
    this.name = 'MayInKhongTimThay';
  }
}

/**
 * Tạo máy in mới: gen token random 32 byte base64url (chuẩn refresh-token-service),
 * tạo dòng print_agents, trả cả token GỐC — CHỈ LẦN NÀY, gọi lại danhSachMayIn
 * sau đó sẽ không bao giờ thấy token đầy đủ nữa.
 *
 * laMacDinh=true: trong CÙNG transaction, bỏ mặc định của mọi máy khác cùng
 * org trước khi tạo — đảm bảo đúng 1 máy/org có laMacDinh=true tại mọi thời điểm.
 */
export async function taoMayIn(
  input: TaoMayInInput,
): Promise<{ mayIn: MayInAnToan; token: string }> {
  const token = randomBytes(32).toString('base64url');
  const laMacDinh = input.laMacDinh ?? false;

  const row = await prisma.$transaction(async (tx) => {
    if (laMacDinh) {
      await tx.printAgent.updateMany({
        where: { orgId: input.orgId, laMacDinh: true },
        data: { laMacDinh: false },
      });
    }
    return tx.printAgent.create({
      data: {
        orgId: input.orgId,
        ten: input.ten,
        token,
        warehouseIds: input.warehouseIds,
        laMacDinh,
      },
    });
  });

  return { mayIn: toAnToan(row), token };
}

/** Danh sách máy in của org — token CHỈ hiện đuôi, kèm trạng thái online. */
export async function danhSachMayIn(orgId: string): Promise<MayInAnToan[]> {
  const rows = await prisma.printAgent.findMany({
    where: { orgId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toAnToan);
}

/**
 * Sửa máy in — scope orgId chặt (máy org khác coi như không tồn tại, ném lỗi).
 * laMacDinh=true: bỏ mặc định các máy KHÁC (id != máy đang sửa) cùng org, cùng
 * transaction với update — không có khe hở 2-máy-cùng-mặc-định.
 */
export async function suaMayIn(
  orgId: string,
  id: string,
  input: SuaMayInInput,
): Promise<MayInAnToan> {
  const hienTai = await prisma.printAgent.findFirst({ where: { id, orgId } });
  if (!hienTai) throw new MayInKhongTimThay(id);

  const data: Record<string, unknown> = {};
  if (input.ten !== undefined) data.ten = input.ten;
  if (input.warehouseIds !== undefined) data.warehouseIds = input.warehouseIds;
  if (input.laMacDinh !== undefined) data.laMacDinh = input.laMacDinh;

  const row = await prisma.$transaction(async (tx) => {
    if (input.laMacDinh === true) {
      await tx.printAgent.updateMany({
        where: { orgId, laMacDinh: true, id: { not: id } },
        data: { laMacDinh: false },
      });
    }
    return tx.printAgent.update({ where: { id }, data });
  });

  return toAnToan(row);
}

/** Xoá máy in — scope orgId chặt, máy org khác ném lỗi thay vì xoá nhầm. */
export async function xoaMayIn(orgId: string, id: string): Promise<void> {
  const hienTai = await prisma.printAgent.findFirst({ where: { id, orgId } });
  if (!hienTai) throw new MayInKhongTimThay(id);
  await prisma.printAgent.delete({ where: { id } });
}

/** Danh sách kho chuẩn (tái dùng kieu.ts, không khai lại). */
export function danhSachKho(): typeof KHO {
  return KHO;
}
