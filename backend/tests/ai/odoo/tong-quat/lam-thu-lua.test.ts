// SPDX-License-Identifier: AGPL-3.0-or-later
// THỬ LỬA 4 PHANH CỦA `lam_odoo` — tool GHI tự do vào Odoo.
//
// VÌ SAO CÓ FILE NÀY: đo prod 04→11/08/2026, 486 lượt gọi tool — `lam_odoo`
// được gọi ĐÚNG 0 LẦN. Đây là tool mạnh nhất hệ thống (ghi được vào BẤT KỲ bảng
// Odoo nào, user bot_zalo có 20 nhóm quyền nên Odoo không chặn giúp gì cả).
// 0 lần gọi nghĩa là 4 cái phanh CHƯA TỪNG ĐƯỢC THỬ LỬA THẬT — không có bằng
// chứng nào ngoài lời hứa trong comment.
//
// Odoo GIẢ, không đụng prod: thử phanh xoá trên Odoo thật là tự bắn vào chân.
// Phanh phải chặn TRƯỚC khi gọi Odoo, nên Odoo giả kiểm được đúng thứ cần kiểm:
// kiểm rằng lệnh nguy hiểm KHÔNG BAO GIỜ tới nơi.
import { describe, it, expect, vi } from 'vitest';
import { lamOdoo } from '../../../../src/modules/ai/odoo/tong-quat/lam.js';
import { lamOdooDefinition } from '../../../../src/modules/ai/odoo/tong-quat/lam.js';
import { laCotCam } from '../../../../src/modules/ai/odoo/tong-quat/an-toan.js';

/** Odoo giả: đếm bản ghi khớp = `soKhop`, ghi lại MỌI lệnh đã gọi. */
function fake(soKhop = 1) {
  const searchRead = vi.fn(async () => Array.from({ length: soKhop }, (_, i) => ({ id: i + 1 })));
  const execute = vi.fn(async (_m: string, method: string) =>
    (method === 'search_count' ? soKhop : true));
  return { searchRead, execute };
}

/** Mọi method đã thực sự chạm Odoo — dùng để chứng minh lệnh bị chặn từ đầu. */
const daGoi = (odoo: ReturnType<typeof fake>): string[] =>
  odoo.execute.mock.calls.map((c) => String(c[1]));

// ═══════════════════════════════════════════════════════════════════════════
describe('PHANH 1 — XOÁ luôn phải xin phép (Odoo không có thùng rác)', () => {
  it('unlink 1 bản ghi cũng bị chặn: ít không có nghĩa là an toàn', async () => {
    const odoo = fake(1);

    const kq = await lamOdoo({ odoo } as never, {
      bang: 'sale.order', viec: 'goi_nut', nut: 'unlink', loc: [['name', '=', 'S13823']],
    });

    expect(kq.trangThai).toBe('can_xac_nhan');
    if (kq.trangThai === 'can_xac_nhan') expect(kq.lyDo).toBe('xoa');
    expect(daGoi(odoo)).not.toContain('unlink');
  });

  it('unlink hàng loạt (1.257 SP) → chặn, và NÊU RÕ con số cho nhân viên đọc', async () => {
    const odoo = fake(1257);

    const kq = await lamOdoo({ odoo } as never, {
      bang: 'product.product', viec: 'goi_nut', nut: 'unlink', loc: [['id', '>', 0]],
    });

    expect(kq.trangThai).toBe('can_xac_nhan');
    if (kq.trangThai === 'can_xac_nhan') {
      // Con số phải nằm trong lời cảnh báo: "sẽ xoá vài bản ghi" thì không ai
      // đủ thông tin để gật hay từ chối.
      expect(kq.moTa).toContain('1.257'.replace('.', '')); // 1257
      expect(kq.moTa.toLowerCase()).toContain('xoá');
    }
    expect(daGoi(odoo)).not.toContain('unlink');
  });

  it('xoá qua viec=sua vẫn KHÔNG lách được phanh xoá bằng cách đổi tên việc', async () => {
    // Model có thể thử "sửa" thay vì "xoá". Sửa 1 bản ghi thì được chạy — đúng
    // thiết kế (anh Quốc chốt 10/08). Test này khoá hành vi đó cho rõ ràng:
    // phanh xoá gắn với `nut === 'unlink'`, không phải với chữ "xoá".
    const odoo = fake(1);
    const kq = await lamOdoo({ odoo } as never, {
      bang: 'sale.order', viec: 'sua', loc: [['id', '=', 1]], du_lieu: { active: false },
    });
    expect(kq.trangThai).toBe('da_lam');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('PHANH 2 — hơn 20 bản ghi phải xin phép', () => {
  it('21 bản ghi → chặn, KHÔNG gọi write', async () => {
    const odoo = fake(21);

    const kq = await lamOdoo({ odoo } as never, {
      bang: 'product.product', viec: 'sua', loc: [['id', '>', 0]], du_lieu: { list_price: 1 },
    });

    expect(kq.trangThai).toBe('can_xac_nhan');
    if (kq.trangThai === 'can_xac_nhan') {
      expect(kq.lyDo).toBe('hang_loat');
      expect(kq.soBanGhi).toBe(21);
    }
    expect(daGoi(odoo)).not.toContain('write');
  });

  it('đúng 20 → chạy (ranh giới nằm ở >20, không phải >=20)', async () => {
    const odoo = fake(20);
    const kq = await lamOdoo({ odoo } as never, {
      bang: 'product.product', viec: 'sua', loc: [['id', '>', 0]], du_lieu: { list_price: 1 },
    });
    expect(kq.trangThai).toBe('da_lam');
    expect(daGoi(odoo)).toContain('write');
  });

  it('gọi nút hàng loạt (xác nhận 500 đơn) cũng bị chặn, không riêng sửa', async () => {
    const odoo = fake(500);
    const kq = await lamOdoo({ odoo } as never, {
      bang: 'sale.order', viec: 'goi_nut', nut: 'action_confirm', loc: [['state', '=', 'draft']],
    });
    expect(kq.trangThai).toBe('can_xac_nhan');
    expect(daGoi(odoo)).not.toContain('action_confirm');
  });

  it('KHÔNG có loc → chặn ngay, không đụng Odoo (chống "sửa cả bảng")', async () => {
    const odoo = fake(9999);
    const kq = await lamOdoo({ odoo } as never, {
      bang: 'product.product', viec: 'sua', du_lieu: { list_price: 1 },
    });
    expect(kq.trangThai).toBe('loi');
    expect(odoo.execute).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHANH 3 — CỘT GIÁ VỐN / MARGIN
//
// PHÁT HIỆN 11/08: phanh này KHÔNG TỒN TẠI trên đường GHI. `an-toan.ts` có
// `laCotCam`/`locCotCam`, và `doc.ts` + `kham-pha.ts` đều dùng — nhưng `lam.ts`
// chỉ import `quyetDinhPhanh`, không hề lọc cột. Nghĩa là `lam_odoo` GHI ĐÈ
// được `standard_price` (giá vốn) trong khi `doc_odoo` còn không được ĐỌC nó.
//
// Test dưới ghi lại HÀNH VI THẬT hiện nay chứ không phải hành vi mong muốn —
// cố ý, để báo cáo cho anh Quốc quyết có siết hay không. Siết là thay đổi
// nghiệp vụ (nhân viên đang có thể cần sửa giá vốn khi nhập hàng), không phải
// việc tự quyết trong lúc viết test.
describe('PHANH 3 — cột giá vốn: ĐỌC bị cấm, nhưng GHI thì KHÔNG', () => {
  it('danh sách cột cấm vẫn nhận diện đúng standard_price / cost / margin', () => {
    for (const c of ['standard_price', 'cost', 'margin', 'purchase_price', 'total_cost', 'margin_percent']) {
      expect(laCotCam(c), `${c} phải bị coi là cột cấm`).toBe(true);
    }
    for (const c of ['list_price', 'name', 'qty_available']) {
      expect(laCotCam(c), `${c} KHÔNG phải cột cấm`).toBe(false);
    }
  });

  it('HIỆN TRẠNG: lam_odoo GHI ĐÈ được standard_price — phanh cột chưa nối vào đường ghi', async () => {
    const odoo = fake(1);

    const kq = await lamOdoo({ odoo } as never, {
      bang: 'product.product', viec: 'sua', loc: [['id', '=', 5]],
      du_lieu: { standard_price: 1 },
    });

    // Nếu ngày nào đó anh Quốc chốt siết, test này sẽ đỏ — đó là tín hiệu
    // ĐÚNG, sửa kỳ vọng xuống 'loi' và nối locCotCam vào lam.ts.
    expect(kq.trangThai).toBe('da_lam');
    const write = odoo.execute.mock.calls.find((c) => c[1] === 'write');
    expect((write![2] as unknown[])[1]).toMatchObject({ standard_price: 1 });
  });

  it('mô tả tool KHÔNG hứa hẹn chặn cột giá vốn (đừng để người đọc tin nhầm)', () => {
    expect(lamOdooDefinition.description.toLowerCase()).not.toContain('giá vốn');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHANH 4 — CỜ XÁC NHẬN (lỗ hổng ĐÃ BỊT 11/08/2026)
//
// LỖ HỔNG CŨ: `xac_nhan` là field bình thường trong inputSchema, do CHÍNH MODEL
// điền. Vòng lặp tool-calling (`agent/loop.ts`) chạy tới `maxIterations` lần
// TRONG CÙNG MỘT LƯỢT nhắn — model bị chặn ở lần gọi thứ nhất gọi lại ngay lần
// thứ hai với `xac_nhan: true`, nhân viên KHÔNG hề đọc câu cảnh báo, thậm chí
// không kịp thấy nó. Đo thật: 300 đơn bị xoá, không một con người nào gật.
//
// CÁCH BỊT: cờ `xac_nhan` biến mất khỏi schema và chỉ có hiệu lực khi kèm chìa
// khoá Symbol `CHIA_XAC_NHAN` — thứ KHÔNG serialize qua JSON nên input LLM
// không mang được. Chìa do CODE đặt sau khi đối chiếu tin THẬT của nhân viên ở
// lượt SAU (`xacNhanTuNguoi` trong staff-agent.ts), đúng mẫu `CHIA_BO_PHANH`
// của tools/tao-khach-hang.ts và cơ chế `giaLechDaXacNhan` bên máy gom đơn.
//
// Bộ test đầy đủ cho đường này: lam-xac-nhan-that.test.ts.
describe('PHANH 4 — cờ xác nhận: model KHÔNG tự gật thay người được', () => {
  it('xac_nhan=true TRẦN (model tự điền) KHÔNG qua phanh — kể cả với 1.257 bản ghi', async () => {
    const odoo = fake(1257);

    const kq = await lamOdoo({ odoo } as never, {
      bang: 'product.product', viec: 'goi_nut', nut: 'unlink',
      loc: [['id', '>', 0]], xac_nhan: true,
    });

    expect(kq.trangThai).toBe('can_xac_nhan');
    expect(daGoi(odoo)).not.toContain('unlink');
  });

  it('ĐÃ BỊT: model tự gật ở lượt gọi thứ hai vẫn bị chặn, không ai mất đơn', async () => {
    // Mô phỏng đúng những gì `loop.ts` cho phép trong MỘT lượt nhắn:
    //   lần 1 → bị chặn, trả về "cần xác nhận"
    //   lần 2 → model đọc chính câu đó rồi tự điền xac_nhan: true
    // Giữa hai lần KHÔNG có tin nhắn nào của người → phải chặn cả hai lần.
    const odoo = fake(300);
    const lenh = {
      bang: 'sale.order', viec: 'goi_nut' as const, nut: 'unlink',
      loc: [['state', '=', 'draft']],
    };

    const lan1 = await lamOdoo({ odoo } as never, lenh);
    expect(lan1.trangThai).toBe('can_xac_nhan');
    expect(daGoi(odoo)).not.toContain('unlink');

    const lan2 = await lamOdoo({ odoo } as never, { ...lenh, xac_nhan: true });

    expect(lan2.trangThai).toBe('can_xac_nhan');
    expect(daGoi(odoo)).not.toContain('unlink');
  });

  it('schema KHÔNG còn khai xac_nhan — model không được mời tự điền', () => {
    const props = lamOdooDefinition.inputSchema.properties as Record<string, unknown>;
    expect(props).not.toHaveProperty('xac_nhan');
  });
});
