// SPDX-License-Identifier: AGPL-3.0-or-later
// KHO TÀI LIỆU gửi được — nguồn là bảng `messages`, KHÔNG thêm cột/bảng nào.
//
// VÌ SAO Ở ĐÂY, không phải cột mới trong `knowledge_documents` (11/08/2026):
//
// Bảng `knowledge_documents` chứa NỘI DUNG tài liệu (để RAG trả lời thông số)
// nhưng không có cột đường dẫn file. Bổ sung cột là một lựa chọn — nhưng nguồn
// sự thật về FILE đã có sẵn và đúng hơn: mọi file đi qua Zalo đều nằm trong
// `messages` với content_type='file', `content` là JSON có `title` (tên file
// thật) + `href` (URL tải).
//
// Chọn `messages` vì:
//   1. KHÔNG migration, KHÔNG cột mới, KHÔNG bảng phụ — ít xâm lấn nhất.
//   2. TỰ CẬP NHẬT. Nhân viên gửi datasheet mới vào nhóm là bot gửi lại được
//      NGAY, không cần chạy script nạp nào. Cột trong `knowledge_documents`
//      thì phải nhớ điền mỗi lần nạp — quên một lần là tài liệu câm, mà quên
//      là chuyện chắc chắn xảy ra.
//   3. Hai việc TÁCH RỜI đúng như thực tế: nạp RAG (đọc chữ) và có file (gửi
//      file) không nhất thiết đi cùng nhau. 8 file datasheet đã chứng minh:
//      chúng nạp RAG xong từ trước mà vẫn không gửi được.
//
// ĐÁNH ĐỔI đã cân nhắc: kho này KHÔNG tĩnh — file nào nhân viên gửi vào nhóm
// cũng vào kho, kể cả bảng giá đại lý. Nên `locGiaNoiBo` (trong gui-tai-lieu.ts)
// lọc ở CODE trước khi tool nhìn thấy bất cứ gì.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { locGiaNoiBo, type TaiLieu } from '../odoo/tools/gui-tai-lieu.js';

/** Gốc thư mục file upload — cùng giá trị config.uploadDir. */
const THU_MUC_FILE = process.env.UPLOAD_DIR || '/var/lib/zalo-crm/files';

/**
 * Thư mục cache file tải về. Bám theo nếp `anh-san-pham.ts`: volume `files` là
 * mount bền, thiếu thì rơi về tmp (máy dev / test).
 */
const CACHE_DIR = existsSync(THU_MUC_FILE)
  ? join(THU_MUC_FILE, 'tai-lieu')
  : join(tmpdir(), 'zcrm-tai-lieu');

/** Số file quét từ `messages`. Nhóm chat nhiều năm cũng không quá con số này. */
const QUET_TOI_DA = 500;

/** Hình dạng `content` của tin content_type='file' do Zalo trả về. */
interface NoiDungFile {
  title?: string;
  href?: string;
  params?: string;
}

/** Đọc kích thước file từ `params` (JSON lồng trong JSON — đúng như Zalo gửi). */
function docKichThuoc(params: string | undefined): number {
  if (!params) return 0;
  try {
    const p = JSON.parse(params) as { fileSize?: string | number };
    return Number(p.fileSize ?? 0) || 0;
  } catch {
    return 0;
  }
}

/**
 * Liệt kê tài liệu gửi được của một tổ chức.
 *
 * TRÙNG TÊN thì giữ bản MỚI NHẤT: nhân viên gửi lại datasheet đã sửa thì bản
 * cũ phải nhường chỗ, không thì bot gửi tài liệu lỗi thời cho khách.
 *
 * ƯU TIÊN link NỘI BỘ: cùng một file thường xuất hiện hai lần — một bản href
 * `…:3080/files/media/…` (file nằm trên đĩa server, chắc chắn còn) và một bản
 * href CDN Zalo `file-stal-*.dlfl.vn` (đo 11/08: vẫn tải được, nhưng CDN có
 * thể hết hạn bất cứ lúc nào và mình không kiểm soát). Cùng tên thì lấy bản
 * nội bộ.
 */
export async function lietKeTaiLieu(orgId: string): Promise<TaiLieu[]> {
  const rows = await prisma.message.findMany({
    where: {
      contentType: 'file',
      isDeleted: false,
      conversation: { orgId },
    },
    orderBy: { sentAt: 'desc' },
    take: QUET_TOI_DA,
    select: { content: true },
  });

  const theoTen = new Map<string, TaiLieu>();
  for (const r of rows) {
    if (!r.content) continue;
    let j: NoiDungFile;
    try {
      j = JSON.parse(r.content) as NoiDungFile;
    } catch {
      continue; // tin file hỏng JSON — bỏ, không phá cả danh sách
    }
    const tieuDe = j.title?.trim();
    const duongDan = j.href?.trim();
    if (!tieuDe || !duongDan) continue;

    const cu = theoTen.get(tieuDe);
    // rows đã sắp mới→cũ, nên bản đầu tiên gặp là mới nhất. Chỉ thay khi bản
    // đang giữ dùng CDN mà bản này là link nội bộ (bền hơn).
    if (cu && !laLinkNoiBo(cu.duongDan)) {
      if (!laLinkNoiBo(duongDan)) continue;
    } else if (cu) {
      continue;
    }
    theoTen.set(tieuDe, { tieuDe, duongDan, kichThuoc: docKichThuoc(j.params) });
  }

  // LỌC GIÁ NỘI BỘ ở đây — cửa duy nhất giữa kho file động và hai luồng agent.
  return locGiaNoiBo([...theoTen.values()]);
}

/** Link trỏ vào chính server mình (`/files/media/…`) — file nằm trên đĩa. */
function laLinkNoiBo(href: string): boolean {
  return href.includes('/files/media/');
}

/**
 * Đổi href thành đường dẫn ĐĨA nếu là link nội bộ.
 *
 * Đi thẳng vào đĩa thay vì tự gọi HTTP về chính mình: nhanh hơn, không phụ
 * thuộc cổng/rate-limit, và không chết khi server đang bận.
 */
function duongDanDia(href: string): string | null {
  const i = href.indexOf('/files/');
  if (i < 0) return null;
  const duoi = href.slice(i + '/files/'.length);
  const duong = join(THU_MUC_FILE, duoi);
  return existsSync(duong) ? duong : null;
}

/** Tên file cache — giữ nguyên ĐUÔI vì zca-js nhận diện loại file theo đuôi. */
function duongDanCache(t: TaiLieu): string {
  const hash = createHash('sha1').update(t.duongDan).digest('hex').slice(0, 16);
  const duoi = /\.[a-z0-9]{1,5}$/i.exec(t.tieuDe)?.[0] ?? '.pdf';
  return join(CACHE_DIR, `${hash}${duoi}`);
}

/**
 * Lấy tài liệu về đường dẫn cục bộ để `zaloOps.sendFile` gửi được.
 *
 * Ba nước, theo thứ tự chắc chắn giảm dần:
 *   1. File nội bộ đã nằm trên đĩa → dùng thẳng, không tải gì.
 *   2. Cache đã tải lần trước → dùng lại.
 *   3. Tải từ CDN Zalo → ghi cache. CDN có thể hết hạn; hỏng thì NÉM để tool
 *      trả 'loi' và bot nói thật, thay vì khoe "đã gửi" một file không tồn tại.
 *
 * TÊN FILE GỬI ĐI: giữ đuôi .pdf là bắt buộc — zca-js nhận diện loại file theo
 * ĐUÔI (đã ghi trong gui-zalo.ts:guiFile, học từ ca .xlsx 06/08).
 */
export async function taiTaiLieuVe(t: TaiLieu): Promise<string> {
  const dia = laLinkNoiBo(t.duongDan) ? duongDanDia(t.duongDan) : null;
  if (dia) return dia;

  const cache = duongDanCache(t);
  if (existsSync(cache)) return cache;

  mkdirSync(CACHE_DIR, { recursive: true });
  const res = await fetch(t.duongDan, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`tải "${t.tieuDe}" → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // File PDF thật không bao giờ nhỏ thế này — nhỏ hơn nghĩa là CDN trả trang
  // lỗi/redirect HTML. Gửi cái đó cho khách còn tệ hơn nói "chưa có".
  if (buf.length < 1024) throw new Error(`"${t.tieuDe}" tải về chỉ ${buf.length}B — nghi lỗi CDN`);
  writeFileSync(cache, buf);
  logger.info(
    { tieuDe: t.tieuDe, cache, kb: Math.round(buf.length / 1024) },
    '[kho-tai-lieu] đã tải tài liệu về cache',
  );
  return cache;
}

/**
 * Dựng bộ đôi deps cho tool `gui_tai_lieu`. Kho RỖNG → undefined để tool KHÔNG
 * được đăng ký.
 *
 * Cùng nguyên tắc với `timTriThuc`: không đăng ký còn hơn đăng ký rồi luôn
 * rỗng — model sẽ gọi, không thấy gì, rồi hứa lèo. Mà hứa gửi tài liệu rồi
 * không gửi CHÍNH LÀ bug 03:17-03:18 ngày 11/08.
 */
export async function khoTaiLieuCuaOrg(
  orgId: string,
): Promise<(() => Promise<TaiLieu[]>) | undefined> {
  // NUỐT LỖI có chủ ý. Đây là bước PHỤ trong một lượt trả lời: gửi được tài
  // liệu là điểm cộng, còn trả lời được câu hỏi mới là việc chính. Để một truy
  // vấn đếm file ném ra và giết cả lượt thì bot câm — đắt hơn nhiều so với
  // việc mất khả năng gửi file trong lượt đó.
  //
  // Cùng nếp với `searchKnowledge` rơi về lexical-only khi embedding chết:
  // hỏng một nhánh phụ không được kéo sập nhánh chính.
  try {
    const so = await prisma.message.count({
      where: { contentType: 'file', isDeleted: false, conversation: { orgId } },
    });
    if (so === 0) return undefined;
    return () => lietKeTaiLieu(orgId);
  } catch (err) {
    logger.warn({ err, orgId }, '[kho-tai-lieu] không đếm được file — tắt gửi tài liệu lượt này');
    return undefined;
  }
}
