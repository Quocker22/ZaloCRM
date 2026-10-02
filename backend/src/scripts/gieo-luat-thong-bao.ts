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
 * Chạy — nằm trong `src/` nên `tsc` biên dịch cùng app vào `dist/scripts/` (image prod CHỈ có dist, không có tsx/src —
 * giám sát docs/78 D3). DATABASE_URL lấy từ env:
 *   image:   node dist/scripts/gieo-luat-thong-bao.js --org <org_id> [--che-do bong|bat|tat]
 *   máy dev: npx tsx src/scripts/gieo-luat-thong-bao.ts --org <org_id>
 * `--help` in cách dùng, thoát 0 TRƯỚC khi nạp Prisma (không cần DB).
 */
import type * as LuatThongBao from '../modules/bot-quyen/bot-thong-bao-luat.js';

const CACH_DUNG = `Gieo hai luật chủ chọn 02/10 (docs/78 C2) cho MỘT org — mặc định chế độ bóng (ghi sổ, không gửi).
Cách dùng: node dist/scripts/gieo-luat-thong-bao.js --org <org_id> [--che-do bong|bat|tat]
  --org      id tổ chức (bắt buộc)
  --che-do   tat | bong (mặc định) | bat
Từ chối (mã thoát 1) khi bot chưa gửi ảnh chụp bản đồ tin; loại đã có luật thì bỏ qua, không đè.`;

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(CACH_DUNG);
    return 0;
  }
  // nạp muộn: prisma-client đọc config lúc import — `--help` và lỗi tham số không được phụ thuộc DB
  const { docThamSoGieo, LoiLuatThongBao } = await import('../modules/bot-quyen/bot-thong-bao-luat.js');
  let ts: ReturnType<typeof LuatThongBao.docThamSoGieo>;
  try {
    ts = docThamSoGieo(argv);
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`);
    console.error(CACH_DUNG);
    return 2;
  }
  const { gieoLuatChuChon } = await import('../modules/bot-quyen/bot-thong-bao-service.js');
  const { prisma } = await import('../shared/database/prisma-client.js');
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
