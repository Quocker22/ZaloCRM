// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * loai-tru-tai-lieu-noi-bo.ts — chuyển đường khách sang "MỌI tài liệu trừ loại trừ" (docs/79, chủ chốt 02/10 tối): loại trừ sẵn các
 * tài liệu kho tri thức có DẤU HIỆU NỘI BỘ (bảng giá, giá đại lý, công nợ, tồn kho…) cho MỘT org, qua đúng service quản trị (nhật ký
 * bot_quyen_nhat_ky, ai = "cli:loai-tru-tai-lieu-noi-bo").
 *
 * Mặc định CHỈ LIỆT KÊ; thêm `--ap` mới ghi. Chạy lặp an toàn (đã loại trừ ⇒ bỏ qua).
 *   image:   node dist/scripts/loai-tru-tai-lieu-noi-bo.js --org <org_id> [--ap]
 *   máy dev: npx tsx src/scripts/loai-tru-tai-lieu-noi-bo.ts --org <org_id> [--ap]
 */
const CACH_DUNG = `Loại trừ sẵn tài liệu có dấu hiệu nội bộ khỏi đường trả lời khách (docs/79).
Cách dùng: node dist/scripts/loai-tru-tai-lieu-noi-bo.js --org <org_id> [--ap]
  --org   id tổ chức (bắt buộc)
  --ap    ghi thật (mặc định chỉ liệt kê)`;

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(CACH_DUNG);
    return 0;
  }
  const i = argv.indexOf('--org');
  const orgId = i >= 0 ? argv[i + 1] : undefined;
  const la = argv.filter((a, k) => a !== '--ap' && a !== '--org' && k !== i + 1);
  if (!orgId || orgId.startsWith('--') || la.length > 0) {
    console.error(`✗ tham số sai${la.length ? `: ${la.join(' ')}` : ''}`);
    console.error(CACH_DUNG);
    return 2;
  }
  const ap = argv.includes('--ap');
  // nạp muộn: prisma-client đọc config lúc import — `--help` và lỗi tham số không được phụ thuộc DB
  const { loaiTruTaiLieuNoiBo } = await import('../modules/bot-quyen/bot-cho-khach-service.js');
  const { prisma } = await import('../shared/database/prisma-client.js');
  try {
    const kq = await loaiTruTaiLieuNoiBo(orgId, 'cli:loai-tru-tai-lieu-noi-bo', ap);
    for (const t of kq.deXuat) {
      console.log(`${t.daLoaiTru ? '· đã loại' : ap ? '✓ loại' : '? sẽ loại'}  ${t.id}  “${t.tieuDe}”  — ${t.dauHieu.join('; ')}`);
    }
    console.log(ap ? `xong: loại thêm ${kq.doi}` : `chỉ liệt kê (${kq.deXuat.filter((t) => !t.daLoaiTru).length} sẽ loại) — thêm --ap để ghi`);
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().then((c) => process.exit(c), (e) => {
  console.error(e);
  process.exit(1);
});
