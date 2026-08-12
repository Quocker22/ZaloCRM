// SPDX-License-Identifier: AGPL-3.0-or-later
// LUỒNG NHÂN VIÊN — nhân viên sai bot: tra cứu, lên đơn, báo cáo.
//
// Đường đi một tin:
//   cổng (công tắc → nhận lệnh → đích gửi → LLM) → chạy agent → gửi kết quả
//
// Mọi lối thoát sớm đi qua `dung(lyDo)` — có log, grep `[agent/nv] dừng` là ra.
import { prisma } from '../../../../shared/database/prisma-client.js';
import { napLuatNhanVien, ghiLuat, quenLuat, type PrismaLuatNv } from '../luat-nhan-vien.js';
import { traAliasSp, ghiAliasSp, type PrismaSpAlias } from '../sp-alias.js';
import { logger } from '../../../../shared/utils/logger.js';
import { chayLenhNhanVien } from '../staff-agent.js';
import { nhanDienLenhNhanVien, coTagBot } from '../staff-command.js';
import { laNhanVienSync } from '../agent-operator-service.js';
import { taoGhiLog, type PrismaGhiLog } from '../ghi-log-tool.js';
import { batLuongNhanVien, duCauHinh, chanDonLienKeGiay, odooUrlCongKhai } from './cong-tac.js';
import { hanGioLuot } from './dung.js';
import { tomTatDoDang } from './ngan-sach.js';
import { dungGenerate } from './llm.js';
import { layOdoo, layAnhClient, timTriThuc, layLichSu, seqTuMessageId, coTinKhachMoiHon } from './du-lieu.js';
import { khoTaiLieuCuaOrg } from '../../knowledge/kho-tai-lieu.js';
import { timDich, guiTin, guiAnh, guiFile, ghiAnhTam } from './gui-zalo.js';
import { xuLyGomDon } from './gom-don/index.js';
import { docPhien, type DbPhienGomDon } from './gom-don/phien-store.js';
import { gopTinTruocKhiTag } from './gop-tin.js';
import { thuGiuViec } from './khoa-viec.js';
import { taoDung, taoMoc, chayCoHanGio } from './dung.js';
import { laXacNhanNgan } from './cam-xuc.js';
import type { NgữCanhTin } from './types.js';

// Prisma sinh kiểu `create` chặt hơn `PrismaGhiLog` (vốn chỉ cần hàm nhận
// `{data}`). Ép ở đúng một chỗ thay vì nới lỏng kiểu trong ghi-log-tool.
const prismaLog = prisma as unknown as PrismaGhiLog;
// Cùng lý do: client $extends của app không khớp generic Exact<> của Prisma —
// store gom-don chỉ cần 3 hàm CRUD trên phien_gom_don.
const prismaPhien = prisma as unknown as DbPhienGomDon;

const dung = taoDung('nv');
const moc = taoMoc('nv');

/**
 * Tin này có phải LỆNH NHÂN VIÊN không — luồng khách gọi để TRÁNH xử lý trùng.
 *
 * Cả hai luồng chạy nền (`void`) nên không chờ nhau được. Thiếu hàm này thì
 * nhân viên gõ lệnh từ nick cá nhân sẽ kích hoạt CẢ HAI: agent trả lời một câu,
 * RAG trả lời câu khác — khách thấy cả hai.
 */
export function laLenhNhanVien(input: {
  orgId: string;
  content: string;
  isSelf: boolean;
  senderUid?: string | null;
  laNhom?: boolean;
  daTagBot?: boolean;
  /**
   * Bot đang hỏi chính người này (phiên gom đơn mở, `hoiUid` khớp).
   *
   * PHẢI khớp với giá trị `xuLyTinNhanVien` tự tính, nếu không hai cổng lệch
   * nhau: luồng nhân viên nhận câu "khách mới" mà luồng khách tưởng không phải
   * lệnh nên cũng xử → khách nhận hai câu trả lời. Caller dùng `dangChoTraLoiNv`
   * để lấy đúng giá trị đó.
   */
  dangChoTraLoi?: boolean;
}): boolean {
  if (!batLuongNhanVien() || !duCauHinh()) return false;
  return nhanDienLenhNhanVien({
    // Mention Zalo thật (@TênBot) không chứa chữ "@bot" — quy đổi thành tag.
    content: input.daTagBot ? `@bot ${input.content}` : input.content,
    isSelf: input.isSelf,
    senderUid: input.senderUid,
    batBuocTag: input.laNhom === true,
    dangChoTraLoi: input.dangChoTraLoi,
    laNhanVien: (uid) => laNhanVienSync(input.orgId, uid),
  }) !== null;
}

/**
 * "Bot có đang chờ CHÍNH người này trả lời không?" — nguồn sự thật DUY NHẤT
 * cho cờ `dangChoTraLoi`, dùng chung cho cả cổng nhân viên lẫn cổng tránh của
 * luồng khách. Hai cổng tính khác nhau thì một tin bị hai luồng cùng xử.
 *
 * Chỉ đúng trong NHÓM: chat 1-1 vốn không bắt tag nên không cần nới.
 */
export async function dangChoTraLoiNv(input: {
  conversationId: string;
  senderUid?: string | null;
  laNhom?: boolean;
}): Promise<boolean> {
  if (input.laNhom !== true || !input.senderUid) return false;
  try {
    const phien = await docPhien(prismaPhien, input.conversationId);
    return Boolean(phien?.hoiUid) && phien?.hoiUid === input.senderUid;
  } catch (err) {
    // Lỗi đọc → coi như không có phiên: giữ luật bắt tag chặt như cũ.
    logger.warn({ err }, '[agent/nv] đọc phiên gom đơn lỗi — giữ luật bắt tag');
    return false;
  }
}

/**
 * Xử lý một tin nhân viên. Trả `true` nếu ĐÃ nhận việc (kể cả khi lỗi giữa
 * chừng) — caller không được để luồng khác trả lời chồng lên.
 */
export async function xuLyTinNhanVien(ctx: NgữCanhTin): Promise<boolean> {
  if (!batLuongNhanVien() || !duCauHinh()) {
    return dung('công tắc tắt hoặc thiếu cấu hình Odoo', {
      bat: batLuongNhanVien(), duCauHinh: duCauHinh(),
    });
  }

  // CỔNG RẺ: nick shop không tag @bot thì không gọi LLM (nó gửi hàng chục tin
  // trả lời khách mỗi ngày). UID trong AI_AGENT_UID_NHANVIEN thì KHÔNG cần tag
  // — TRỪ trong NHÓM: ở đó nhân viên tán gẫu/nói với khách, coi mọi câu là
  // lệnh thì bot chen vào liên tục (06/08/2026). Mention Zalo thật (@TênBot)
  // được quy đổi thành tag "@bot" vì text mention không chứa chữ đó.
  // Bot ĐANG HỎI chính người này? Trong nhóm, câu trả lời cho câu bot vừa hỏi
  // thường không kèm tag ("khách mới", "1", "5 cái") — bắt tag lại thì câu đó
  // bị vứt và phiên treo (bug 17:07-17:08 10/08). Chỉ nới đúng người mở phiên;
  // người khác nói chen vẫn phải tag. Đọc lỗi thì coi như không có phiên —
  // giữ hành vi chặt cũ, không mở toang cổng vì một lỗi DB.
  const dangChoTraLoi = await dangChoTraLoiNv({
    conversationId: ctx.conversationId, senderUid: ctx.senderUid, laNhom: ctx.laNhom,
  });

  const lenh = nhanDienLenhNhanVien({
    content: ctx.daTagBot ? `@bot ${ctx.content}` : ctx.content,
    isSelf: ctx.isSelf ?? true,
    senderUid: ctx.senderUid,
    batBuocTag: ctx.laNhom === true,
    dangChoTraLoi,
    laNhanVien: (uid) => laNhanVienSync(ctx.orgId, uid),
  });
  if (!lenh) {
    return dung('không qua cổng nhận lệnh', {
      senderUid: ctx.senderUid, isSelf: ctx.isSelf, noiDung: ctx.content?.slice(0, 40),
    });
  }

  const dich = await timDich(ctx.conversationId);
  if (!dich) return dung('không tra được thread', { conversationId: ctx.conversationId });

  // TAG TRỐNG — người ta gọi bot mà không kèm nội dung.
  //
  // KHÔNG đáp suông "Dạ em đây": bug 21:04-21:05 10/08 cho thấy câu lệnh nằm
  // ngay TIN TRƯỚC (nhân viên quên tag ở tin đó rồi tag ở tin sau). Anh Quốc:
  // "mấy tin trước đó quên tag thì sao???" — nên đọc ngược lịch sử lấy việc
  // của chính người vừa tag. Không có gì để lấy thì mới hỏi lại.
  // Đứng SAU timDich vì cần đích để gửi.
  if (lenh.tagTrong) {
    const t0Tag = moc.batDau({ noiDung: '(tag trống)' });
    const lichSuTag = await layLichSu(ctx.conversationId, ctx.messageId);
    const gop = ctx.senderUid ? gopTinTruocKhiTag(ctx.senderUid, lichSuTag) : null;
    if (!gop) {
      await guiTin(dich, 'Dạ em đây, anh/chị cần gì ạ?', false);
      moc.xong(t0Tag, { nhanh: 'tag-trong', conversationId: ctx.conversationId });
      return true;
    }
    // Có việc bị bỏ sót → xử như thể nhân viên vừa gõ câu đó kèm tag.
    logger.info(
      { gop: gop.slice(0, 60) }, '[agent/nv] tag trống — lấy nội dung từ tin trước',
    );
    lenh.noiDung = gop;
  }

  // KHOÁ VIỆC — chặn hai lượt cùng xử lý MỘT câu lệnh (bug 21:34:22-24 10/08:
  // tin gốc tự chạy, rồi tag trống nuốt lại đúng câu đó → bot trả lời 2 lần).
  // Đặt SAU khi đã chốt nội dung cuối (kể cả nội dung gộp từ tag trống) và
  // TRƯỚC mọi việc tốn tiền. Không giữ được = lượt khác đang làm → im lặng.
  if (!(await thuGiuViec(ctx.conversationId, lenh.noiDung))) {
    return dung('việc này lượt khác đang xử lý', {
      conversationId: ctx.conversationId, noiDung: lenh.noiDung.slice(0, 40),
    });
  }

  // NGÂN SÁCH THỜI GIAN cho cả lượt (11/08). Mọi lần gọi model bên dưới chỉ
  // được chờ trong phần còn lại — trước đây một vòng thử-lại được phép chạy
  // 109s trong khi hạn tổng chỉ 90s, nên chỉ cần gateway chậm một lần là cả
  // lượt chết kèm câu "Bot gặp lỗi (quá hạn 90000ms)".
  const hanChot = Date.now() + hanGioLuot();
  const generate = await dungGenerate(ctx.orgId, hanChot);
  if (!generate) return dung('chưa cấu hình LLM cho tổ chức', { orgId: ctx.orgId });

  const t0 = moc.batDau({ noiDung: lenh.noiDung.slice(0, 50) });
  const ghiDbGoc = taoGhiLog({
    prisma: prismaLog, orgId: ctx.orgId, vai: 'nhanvien', conversationId: ctx.conversationId,
    onError: (err) => logger.warn({ err }, '[agent/nv] ghi log tool lỗi'),
  });
  // Giữ lại kết quả tool để nếu hết giờ còn có cái mà trả lời (11/08) — thay
  // vì vứt hết rồi báo "Bot gặp lỗi".
  const daTra: Array<{ toolName: string; output: string; thanhCong: boolean }> = [];
  const ghiDb = (l: Parameters<typeof ghiDbGoc>[0]): void => {
    daTra.push({
      toolName: l.toolName,
      output: typeof l.output === 'string' ? l.output : JSON.stringify(l.output ?? ''),
      thanhCong: l.thanhCong,
    });
    ghiDbGoc(l);
  };

  try {
    // MÁY GOM ĐƠN (spec 07/08) — đứng TRƯỚC agent thường: lệnh "lên đơn" và
    // phiên đang mở là việc của máy trạng thái (code quyết hỏi gì, LLM chỉ
    // trích slot). Máy trả false = tin là việc khác → agent thường xử như cũ.
    // Lỗi trong máy rơi xuống catch dưới — nhân viên luôn được báo, không im.
    // LUAT NHAN VIEN DAN (12/08) — nap TRUOC may gom don: ca 20:32 cung ngay,
    // luat "chiet khau 5%" vua ghi xong ma don S13839 ra khong chiet khau vi
    // luat chi den agent thuong (chay SAU gom don). DB loi -> [] — khong cam.
    const luatNv = await napLuatNhanVien(prisma as unknown as PrismaLuatNv, ctx.orgId);

    const gomDonNhan = await chayCoHanGio('nv', xuLyGomDon(
      {
        prisma: prismaPhien, odoo: layOdoo(), generate, anhClient: layAnhClient() ?? null,
        luatNhanVien: luatNv,
        // Alias SP học được (P1.3) — bot khớp thẳng tên gọi NV đã dạy một lần.
        traAliasSp: (tuKhoa) => traAliasSp(prisma as unknown as PrismaSpAlias, ctx.orgId, tuKhoa),
        ghiAliasSp: (v) => ghiAliasSp(prisma as unknown as PrismaSpAlias, { orgId: ctx.orgId, ...v }),
        // Prod luôn có URL công khai; thiếu (dev) thì link thành tương đối —
        // xấu nhưng không chặn luồng tạo đơn.
        odooUrl: odooUrlCongKhai() ?? '',
        guiTin: (t) => guiTin(dich, t, false),
        guiAnhHoaDon: async (anh) => guiAnh(dich, await ghiAnhTam(anh.duLieu, anh.tenFile), false),
        ghiLog: ghiDb,
      },
      {
        orgId: ctx.orgId, conversationId: ctx.conversationId,
        seq: seqTuMessageId(ctx.messageId), cau: lenh.noiDung,
        senderUid: ctx.senderUid ?? null,
      },
    ));
    if (gomDonNhan) {
      moc.xong(t0, { nhanh: 'gom-don', conversationId: ctx.conversationId });
      return true;
    }

    const lichSu = await layLichSu(ctx.conversationId, ctx.messageId);
    // Log từng chặng: treo ở đâu thì dòng cuối cùng chỉ thẳng ra chỗ đó.
    logger.info({ soTin: lichSu.length }, '[agent/nv] đã lấy lịch sử');
    const triThuc = await timTriThuc(ctx.orgId);
    // Kho FILE tài liệu — tách hẳn khỏi tri thức (chữ). Bug 03:17 11/08 chính
    // là bot có cái thứ nhất mà không có cái thứ hai, rồi kết luận "chưa có file".
    const khoTaiLieu = await khoTaiLieuCuaOrg(ctx.orgId);
    logger.info(
      { coTriThuc: Boolean(triThuc), coTaiLieu: Boolean(khoTaiLieu) },
      '[agent/nv] đã dựng tri thức — vào LLM',
    );

    const r = await chayCoHanGio('nv', chayLenhNhanVien(
      {
        odoo: layOdoo(),
        generate,
        chanDonLienKeGiay: chanDonLienKeGiay(),
        zaloUid: dich.zaloUid,
        ghiNhanChuyenSale: async (yc) => {
          logger.info({ lyDo: yc.lyDo, conversationId: ctx.conversationId }, '[agent/nv] chuyển sale');
        },
        ghiLog: ghiDb,
        anhClient: layAnhClient(),
        // Link cho NGƯỜI bấm — phải là domain công khai, không phải hostname
        // Docker nội bộ (bug thật 06/08: "http://incokit_nginx_prod/web#...").
        odooUrl: odooUrlCongKhai(),
        timDoanTriThuc: triThuc,
        lietTaiLieu: khoTaiLieu,
        luatNhanVien: luatNv,
        luatStore: {
          ghi: (v) => ghiLuat(prisma as unknown as PrismaLuatNv, {
            orgId: ctx.orgId, noiDung: v.noiDung,
            ...(v.phamVi ? { phamVi: v.phamVi } : {}),
            conversationId: ctx.conversationId,
          }),
          quen: (v) => quenLuat(prisma as unknown as PrismaLuatNv, {
            orgId: ctx.orgId, tuKhoa: v.tuKhoa,
          }),
        },
      },
      {
        bizName: ctx.bizName,
        conversationId: ctx.conversationId,
        seq: seqTuMessageId(ctx.messageId),
        // GỬI NỘI DUNG ĐÃ QUA CỔNG, không phải `ctx.content` thô.
        //
        // Bug thật 2026-08-05: `chayLenhNhanVien` kiểm cổng LẦN HAI, nhưng ở
        // đó KHÔNG có `senderUid` — nên tin từ UID nhân viên mà không gõ `@bot`
        // bị chính nó từ chối (`khong_phai_lenh`), rồi nhánh đó `return false`
        // KHÔNG log gì. Nhìn log tưởng agent treo ở lượt LLM; thực ra nó thoát
        // ngay sau 0,00s. Mất một buổi mới tìm ra.
        //
        // `lenh.noiDung` đã bỏ tag và ĐÃ qua cổng bảo mật ở trên — nối `@bot`
        // lại để cổng thứ hai luôn nhận, dù người gửi không tự gõ tag.
        message: { content: `@bot ${lenh.noiDung}`, isSelf: true },
        // GÁN VAI THEO NGƯỜI GỬI THẬT, không suy mù từ senderType (bug thật
        // 06/08/2026 13:02): mapping cũ `self→nhanvien, còn lại→bot` bị NGƯỢC
        // khi nhân viên gõ từ nick cá nhân (contact): model đọc lịch sử thấy
        // "BOT ra lệnh lên đơn, NHÂN VIÊN liệt kê 10 khách" — lú hoàn toàn,
        // nhai lại câu tồn kho cũ thay vì xử lý tin mới, 0 tool nào chạy.
        //
        //   self + có tag bot   → nhanvien (lệnh cũ gõ từ nick shop)
        //   self không tag      → bot (bot hoặc sale trả khách — đều "phía shop")
        //   cùng UID người đang ra lệnh → nhanvien (lệnh cũ từ nick cá nhân)
        //   còn lại             → khach
        history: lichSu.map((m) => ({
          vai:
            m.senderType === 'self'
              ? coTagBot(m.content) ? ('nhanvien' as const) : ('bot' as const)
              : ctx.senderUid && m.senderUid === ctx.senderUid
                ? ('nhanvien' as const)
                : ('khach' as const),
          noiDung: m.content,
        })),
      },
    ));

    // KHÔNG được im lặng ở đây: cổng trên đã CHO QUA, nên đến được đây mà bị
    // từ chối nghĩa là hai cổng bất đồng — lỗi lập trình, không phải luồng
    // bình thường. Im lặng ở nhánh này chính là thứ giấu bug 05/08 cả buổi.
    if (r.trangThai === 'khong_phai_lenh') {
      return dung('chayLenhNhanVien từ chối dù cổng trên đã cho qua — HAI CỔNG BẤT ĐỒNG', {
        conversationId: ctx.conversationId, noiDung: lenh.noiDung.slice(0, 60),
      });
    }

    // TIN MỚI ĐẾN GIỮA CHỪNG (07/08): nhân viên cũng gõ nhiều tin liên tiếp
    // ("báo cáo" rồi "tháng này" rồi "cả đi"). Chưa ghi tool nào → bỏ lượt này,
    // để lượt do tin mới kích trả lời gộp. Đã ghi (tạo đơn) thì KHÔNG bỏ.
    //
    // NGOẠI LỆ (bug S13804 07/08): nếu tin này là lời XÁC NHẬN ("đúng rồi", "ok",
    // "cập nhật đi") thì TUYỆT ĐỐI KHÔNG bỏ — dù có tin xác nhận mới hơn. Trước
    // đây nhân viên gõ "đúng rồi" nhiều lần, mỗi lượt thấy tin mới hơn → bỏ hết,
    // không lượt nào tạo/sửa đơn, bot hỏi lại vô tận. Xác nhận là tín hiệu quyết
    // định, phải xử ngay cho ra tool ghi.
    const soToolNv = r.trangThai === 'xong' ? r.log.length : (r.log?.length ?? 0);
    const laXacNhan = laXacNhanNgan(lenh.noiDung);
    if (soToolNv === 0 && !laXacNhan && await coTinKhachMoiHon(ctx.conversationId, ctx.messageId)) {
      moc.xong(t0, { boQua: 'tin mới hơn', conversationId: ctx.conversationId });
      return true;
    }

    if (r.trangThai === 'xong') {
      // Nhân viên KHÔNG cần giả nhịp người — họ biết đang nói với bot.
      await guiTin(dich, r.traLoi, false);
      // Hoá đơn: ảnh để xem, link để bấm vào xử lý — gửi link DÙ ảnh lỗi.
      if (r.hoaDon) {
        if (r.hoaDon.anh) {
          try {
            await guiAnh(dich, await ghiAnhTam(r.hoaDon.anh.duLieu, r.hoaDon.anh.tenFile), false);
          } catch (err) {
            logger.warn({ err }, '[agent/nv] gửi ảnh hoá đơn lỗi (vẫn gửi link)');
          }
        }
        await guiTin(dich, `Hoá đơn ${r.hoaDon.maDon}: ${r.hoaDon.link}`, false);
      }
      // Báo cáo dài (spec 06/08) — gửi SAU text. Mặc định là ẢNH (zca-js gửi
      // ảnh ổn định; .xlsx hay rớt âm thầm — bug thật 06/08). Lỗi từng cái
      // không phá cái còn lại.
      for (const tep of r.tepBaoCao ?? []) {
        try {
          const duongDan = await ghiAnhTam(tep.duLieu, tep.tenFile);
          if (tep.loai === 'file') await guiFile(dich, duongDan, tep.moTa);
          else await guiAnh(dich, duongDan, false);
        } catch (err) {
          logger.warn({ err, tenFile: tep.tenFile }, '[agent/nv] gửi ảnh/file báo cáo lỗi (đã có text tóm tắt)');
        }
      }
      // TÀI LIỆU PDF (11/08) — nhân viên xin "gửi cho a dạng tài liệu cattalog"
      // thì đây là chỗ file thật rời khỏi hệ thống. File đã nằm sẵn trên đĩa
      // (hoặc trong cache) từ lúc tool chạy, nên ở đây chỉ còn việc gửi.
      //
      // Lỗi từng file KHÔNG phá file còn lại, cũng không phá câu text đã gửi.
      // Nhưng phải LOG rõ: hàng rào `khoeDaGuiTaiLieu` đã cho câu "đã gửi" đi
      // qua vì tool lấy được file — rớt ở khâu này là bot nói thật mà file vẫn
      // không tới, và chỉ log mới cho biết điều đó.
      for (const tl of r.taiLieu ?? []) {
        try {
          await guiFile(dich, tl.duongDanCucBo, '');
          logger.info({ tieuDe: tl.tieuDe }, '[agent/nv] đã gửi tài liệu');
        } catch (err) {
          logger.error(
            { err, tieuDe: tl.tieuDe, duongDan: tl.duongDanCucBo },
            '[agent/nv] GỬI TÀI LIỆU RỚT — bot đã báo "đã gửi" nhưng file không tới',
          );
        }
      }
    } else {
      // Dở dang: báo để nhân viên tự xử, KHÔNG im lặng.
      //
      // Nhưng KHÔNG dán `r.lyDo` vào tin nhắn (sửa 10/08): đó là văn bản kỹ
      // thuật viết cho lập trình viên. Bug 23:38:44 — khách hỏi "bên shop có
      // sản phẩm này không", nhận về nguyên câu 'Bot chưa xử lý xong (Model
      // nói đã gửi ảnh ("...") nhưng KHÔNG có ảnh hoá đơn nào được tạo. Muốn
      // gửi ảnh phải gọi tool gui_hoa_don...)'. Nhóm bán hàng có cả khách.
      // Lý do đầy đủ vẫn nằm trong log — grep '[agent/nv] dở dang' là ra.
      logger.warn(
        { conversationId: ctx.conversationId, lyDo: r.lyDo },
        '[agent/nv] dở dang — đã báo nhân viên',
      );
      await guiTin(dich, 'Dạ khoản này em chưa xử lý được, anh/chị xem giúp em với ạ.', false);
    }

    moc.xong(t0, {
      trangThai: r.trangThai,
      conversationId: ctx.conversationId,
      tokenVao: r.usage.inputTokens,
      tokenCache: r.usage.cacheReadTokens,
    });
    return true;
  } catch (err) {
    logger.error({ err, conversationId: ctx.conversationId }, '[agent/nv] lỗi giữa chừng');
    // Nhân viên gõ lệnh thì PHẢI biết kết quả — im lặng là họ ngồi chờ một
    // câu trả lời không bao giờ tới (bug thật 05/08: lượt treo, log dừng ở
    // "BẮT ĐẦU xử lý", nhân viên không hay biết gì).
    try {
      // KHÔNG dán thông báo kỹ thuật ra nữa (anh Quốc 11/08: "bỏ cái báo lỗi
      // đó đi được không"). Nhân viên đọc "quá hạn 90000ms" thì làm được gì?
      // Lý do đầy đủ đã nằm trong log ở dòng trên.
      //
      // Có dữ liệu tool đã tra được thì TRẢ LỜI bằng nó — bot thường đã biết
      // công nợ, đã tra xong khách, chỉ thiếu bước soạn câu cuối. Vứt hết rồi
      // báo lỗi là phí đúng thứ nhân viên đang cần.
      const doDang = tomTatDoDang(daTra);
      await guiTin(
        dich,
        doDang
          ? `${doDang}\n\n(Em mới tra được tới đây thôi ạ, anh/chị cần thêm gì nhắn em nhé.)`
          : 'Dạ em chưa xử lý kịp, anh/chị nhắn lại giúp em với ạ.',
        false,
      );
    } catch (e2) {
      logger.warn({ err: e2 }, '[agent/nv] báo lỗi cho nhân viên cũng thất bại');
    }
    return true; // đã nhận lệnh rồi — đừng để luồng cũ trả lời chồng lên
  }
}
