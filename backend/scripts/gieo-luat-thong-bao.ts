// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * gieo-luat-thong-bao.ts — tạo hai luật chủ chọn 02/10 (docs/78 C2): bản sao `xuat_hoa_don_tool` → nhóm chức năng
 * ke_toan, bản sao `in_sau_chot` → nhóm chức năng kho — cho MỘT org, qua ĐÚNG service quản trị (kiểm cứng theo ảnh chụp
 * bản đồ tin + nhật ký bot_quyen_nhat_ky, ai = "cli:gieo-luat-thong-bao").
 *
 * Từ chối khi bot CHƯA gửi ảnh chụp bản đồ tin (409) hoặc ảnh chụp thiếu composer (400) — không ghi gì.
 * Chạy lặp an toàn: loại đã có luật thì BỎ QUA (không đè luật chủ đã sửa).
 * Mặc định `bong` (ghi sổ, không gửi): chủ xem số bóng trên trang Bản đồ tin rồi mới bật `bat` (PUT trên CRM hoặc chạy lại
 * với luật đã xoá).
 *
 * Chạy (trong thư mục backend, DATABASE_URL trỏ đúng DB):
 *   npx tsx scripts/gieo-luat-thong-bao.ts --org <org_id> [--che-do bong|bat|tat]
 */
import { docThamSoGieo, LoiLuatThongBao } from '../src/modules/bot-quyen/bot-thong-bao-luat.js';
import { gieoLuatChuChon } from '../src/modules/bot-quyen/bot-thong-bao-service.js';
import { prisma } from '../src/shared/database/prisma-client.js';

async function main(): Promise<number> {
  let ts: ReturnType<typeof docThamSoGieo>;
  try {
    ts = docThamSoGieo(process.argv.slice(2));
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`);
    return 2;
  }
  try {
    const kq = await gieoLuatChuChon(ts.orgId, { aiId: 'cli:gieo-luat-thong-bao', cheDo: ts.cheDo });
    for (const k of kq) {
      console.log(`${k.ketQua === 'tao' ? '✓ tạo' : '· đã có (bỏ qua, không đè)'}  ${k.loai}  id=${k.id}${k.ketQua === 'tao' ? `  che_do=${ts.cheDo}` : ''}`);
    }
    return 0;
  } catch (e) {
    if (e instanceof LoiLuatThongBao) {
      console.error(`✗ ${e.status} ${e.code}: ${e.message}`);
      return 1;
    }
    throw e;
  } finally {
    await prisma.$disconnect();
  }
}

main().then((c) => process.exit(c), (e) => {
  console.error(e);
  process.exit(1);
});
