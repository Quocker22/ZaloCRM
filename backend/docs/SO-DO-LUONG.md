# Sơ đồ luồng bot Zalo

> **Sơ đồ này VIẾT TAY, không tự sinh từ code.** Sửa luồng xử lý thì phải sửa
> sơ đồ kèm trong cùng commit — sơ đồ lạc hậu còn hại hơn không có sơ đồ.
> **Cập nhật lần cuối: 11/08/2026.**

Viết cho người vận hành đọc: mọi thứ trong sơ đồ là ngôn ngữ nghiệp vụ, không
phải tên file. Tên file chỉ nằm ở chú thích cuối mỗi sơ đồ, để lập trình viên
lần ra chỗ sửa. Chi tiết kỹ thuật + lịch sử bug: `docs/KIEN-TRUC-AGENT.md`.

---

## Sơ đồ 1 — Tổng quan: tin nhắn đi đâu, ai xử, trả lời thế nào

Đọc từ trên xuống. Một tin Zalo vào, hệ thống lưu lại rồi hỏi ba câu theo thứ tự:

1. **Đây là chữ hay là ảnh/file?** Ảnh thì bot đọc ảnh thành chữ rồi quay lại
   đầu hàng như một tin chữ bình thường — nhờ vậy ảnh dùng được đủ nghiệp vụ
   (lên đơn, tra khách, tra giá) mà không phải làm riêng một đường.
2. **Nhân viên ra lệnh hay khách hỏi?** Nhân viên có quyền ghi vào Odoo;
   khách thì không (trừ khi bật riêng công tắc cho khách tự chốt).
3. **Việc này là lên đơn/sửa đơn, hay là việc tự do?** Lên đơn thì máy gom đơn
   cầm lái (sơ đồ 2); còn lại thì agent tự tra Odoo mà trả lời.

Đầu ra cuối cùng luôn là một trong ba: **gửi tin về Zalo**, **ghi vào Odoo**,
hoặc **gọi người thật vào**.

```mermaid
flowchart TD
    A["Tin nhắn Zalo vào<br/>(bot đọc qua nick Zalo)"] --> B["Lưu tin vào CRM"]
    B --> C{"Tin dạng gì?"}

    C -->|"Sticker / GIF / Link"| D["Bỏ qua có chủ đích<br/>(người thật cũng không đáp sticker)"]
    C -->|"Ảnh"| E["Bot đọc ảnh thành chữ"]
    C -->|"Voice / Video / File"| F["Chưa đọc được:<br/>nhắn giữ chân khách + báo nhân viên"]
    C -->|"Chữ"| G

    E -->|"Đọc được"| G{"Ai đang nói?"}
    E -->|"Đọc hỏng"| F

    G -->|"Nhân viên<br/>(nick shop, hoặc UID nhân viên;<br/>trong nhóm phải tag bot)"| NV1
    G -->|"Khách"| KH1

    subgraph NV ["LUỒNG NHÂN VIÊN — được ghi vào Odoo"]
        direction TB
        NV1["Qua các cổng chặn<br/>(xem sơ đồ 3)"] --> NV2{"Câu này là<br/>lên đơn / sửa đơn?"}
        NV2 -->|"Có"| NV3["MÁY GOM ĐƠN cầm lái<br/>(xem sơ đồ 2)"]
        NV2 -->|"Không"| NV4["Agent tự do:<br/>tra hàng, tra khách, công nợ,<br/>báo cáo, tồn kho, tài liệu"]
        NV3 --> NV5["Tạo / sửa đơn nháp trong Odoo"]
        NV4 --> NV6["Soạn câu trả lời<br/>từ dữ liệu Odoo tra được"]
    end

    subgraph KH ["LUỒNG KHÁCH — chỉ tư vấn, không đặt được đơn"]
        direction TB
        KH1["Qua các cổng chặn<br/>(xem sơ đồ 3)"] --> KH2{"Khách đang bực / chửi?"}
        KH2 -->|"Có"| KH9["Bot ngừng, gọi người thật vào"]
        KH2 -->|"Không"| KH3["Agent tư vấn:<br/>tra sản phẩm, giá, danh mục,<br/>tri thức shop, tài liệu PDF"]
        KH3 --> KH4{"Bot trả lời được?"}
        KH4 -->|"Được"| KH5["Câu trả lời + ảnh sản phẩm<br/>(+ tài liệu nếu khách xin)"]
        KH4 -->|"Bí / lỗi / khách đòi gặp người"| KH9
    end

    NV5 --> Z1
    NV6 --> Z1
    KH5 --> Z1
    KH9 --> Z3

    Z1["Gửi tin về Zalo<br/>(kèm ảnh hoá đơn, file báo cáo, QR)"]
    Z3["Nhắn giữ chân khách<br/>+ báo nhân viên vào tiếp"]
    F --> Z3
```

**Chú thích cho lập trình viên:** điểm vào `chat/message-handler.ts` ·
phân loại ảnh/file `noi-zalo/luong-media.ts` + `doc-anh.ts` · luồng nhân viên
`noi-zalo/luong-nhan-vien.ts` → `staff-agent.ts` (22 tool) · luồng khách
`noi-zalo/luong-khach.ts` → `customer-agent.ts` (8 tool) · máy gom đơn
`noi-zalo/gom-don/index.ts` · gửi ra Zalo `noi-zalo/gui-zalo.ts` · gọi người
`noi-zalo/bao-nhan-vien.ts`. Ngoài ra: khi nick bot vừa được thêm vào một nhóm
mới, `noi-zalo/chao-nhom.ts` đọc 30 tin gần nhất rồi chào **đúng một lần cho
mỗi nhóm, vĩnh viễn** — đây là đường riêng, không đi qua sơ đồ trên.

---

## Sơ đồ 2 — Máy gom đơn: bot hỏi gì tiếp theo

Khi nhân viên nói "lên đơn cho anh A 5 cái B" hoặc "sửa đơn", **code** quyết
định hỏi gì tiếp — không phải model tự nghĩ. Model chỉ làm một việc: bóc thông
tin trong câu ra thành ô (khách nào, hàng gì, mấy cái, giá bao nhiêu).

Mỗi lượt tin, máy nhìn phiên đang gom rồi chọn **đúng một** việc để làm, theo
thứ tự ưu tiên cố định: tra cứu trước → báo không thấy → hỏi chọn khi nhập
nhằng → hỏi phần còn thiếu → kiểm giá/kho → cuối cùng mới chốt đơn.

Phiên sống 15 phút; hết giờ thì bỏ, nhân viên nói lại từ đầu.

```mermaid
stateDiagram-v2
    [*] --> TraCuu: "lên đơn ..." / "sửa đơn ..."<br/>hoặc đang có phiên dở

    TraCuu: Tra cứu Odoo
    TraCuu: tìm khách và từng mặt hàng cùng lúc
    TraCuu --> KhongThayDon: chế SỬA mà không có đơn nháp nào
    TraCuu --> TaoKhach: nhân viên nói rõ "khách mới"<br/>hoặc tra không ra mà đã cho tên
    TraCuu --> KhongThay: tra rồi vẫn không thấy khách / hàng
    TraCuu --> HoiChonDon: chế SỬA, có nhiều đơn nháp
    TraCuu --> HoiChon: một tên ra nhiều khách<br/>hoặc nhiều mặt hàng giống nhau
    TraCuu --> HoiThieu: đã rõ hết nhưng còn ô trống

    KhongThayDon: Báo "không có đơn nháp để sửa"
    KhongThayDon --> [*]

    KhongThay: Báo "không tìm thấy ..."
    KhongThay --> [*]

    TaoKhach: Tạo khách mới trong Odoo
    TaoKhach --> HoiThieu

    HoiChonDon: Hỏi "sửa đơn nào?"
    HoiChonDon --> TraCuu: nhân viên chọn

    HoiChon: Hỏi chọn khách / chọn hàng<br/>(gộp trong MỘT tin)
    HoiChon --> TraCuu: nhân viên chọn "1a", mã KH, SĐT...

    HoiThieu: Hỏi ô còn thiếu, mỗi lượt MỘT ô
    HoiThieu: thứ tự khách -> hàng -> số lượng
    HoiThieu --> TraCuu: nhân viên trả lời
    HoiThieu --> HoiGia: đủ ô, nhưng hàng chưa có giá thật<br/>(hàng tặng được miễn)
    HoiThieu --> HoiKho: đủ giá, nhưng hàng nằm ở nhiều kho<br/>và nhân viên chưa nói kho
    HoiThieu --> HoiGiaLech: giá nhân viên báo lệch vô lý<br/>so với hệ thống (dưới 0,1 hoặc trên 10 lần)
    HoiThieu --> SuaDon: chế SỬA và đã đủ rõ
    HoiThieu --> TomTat: chế LÊN ĐƠN và đã đủ hết

    HoiGia: Hỏi "hàng này báo giá bao nhiêu?"
    HoiGia --> TraCuu: nhân viên báo giá

    HoiKho: Hỏi "xuất kho nào?"<br/>(chỉ hỏi MỘT lần)
    HoiKho --> TraCuu: nhân viên chọn kho

    HoiGiaLech: Hỏi lại "giá này có đúng không?"<br/>(gật cho tóm tắt cũ KHÔNG tính)
    HoiGiaLech --> TraCuu: nhân viên xác nhận đúng con số đó

    TomTat: Tóm tắt đơn, hỏi "chốt lên đơn nhé?"
    TomTat --> TaoDon: nhân viên gật ("ok", "đúng rồi")
    TomTat --> TraCuu: nhân viên sửa lại thông tin

    TaoDon: Tạo đơn nháp trong Odoo<br/>gửi ảnh + link hoá đơn
    TaoDon --> [*]

    SuaDon: Ghi thẳng vào đơn nháp<br/>(không hỏi chốt lần nữa)
    SuaDon --> [*]
```

**Chú thích cho lập trình viên:** bảng trạng thái ở
`noi-zalo/gom-don/buoc-tiep-theo.ts` (hàm thuần, 13 loại hành động khai trong
`kieu.ts`); orchestrator `gom-don/index.ts`; phiên lưu bảng `phien_gom_don`
TTL 15'; ngưỡng giá lệch đo từ prod ở `gom-don/gia-bat-thuong.ts`.

---

## Sơ đồ 3 — Các cổng chặn: hàng rào nào chặn cái gì

Đây là những hàng rào bot phải chui qua trước và sau khi trả lời. Mỗi cái sinh
ra từ một sự cố thật, không phải phòng xa. Chia ba nhóm theo thời điểm chặn:
**trước khi tốn tiền** (chặn sớm cho rẻ), **khi đang ghi vào Odoo** (chặn để
khỏi hỏng dữ liệu), và **sau khi model soạn xong câu** (chặn bot nói dối).

```mermaid
flowchart TD
    IN["Tin vào"] --> G1

    subgraph P1 ["1 — Chặn TRƯỚC khi tốn tiền model"]
        direction TB
        G1["Cổng nhận lệnh<br/>trong nhóm phải tag bot;<br/>trừ khi bot đang hỏi dở chính người đó"]
        G2["Khoá việc<br/>hai lượt cùng một câu lệnh<br/>thì chỉ một lượt được chạy"]
        G3["Trần tin nhắn<br/>một người dội quá nhiều tin<br/>thì bot ngừng, gọi người xem"]
        G4["Ngân sách 90 giây cho cả lượt<br/>hết giờ: trả những gì đã tra được,<br/>không báo lỗi kỹ thuật"]
        G1 --> G2 --> G3 --> G4
    end

    G4 --> W{"Ai ra lệnh?"}
    W -->|"Nhân viên"| P2
    W -->|"Khách"| P3

    subgraph P2 ["2a — Khi GHI vào Odoo (nhân viên)"]
        direction TB
        H1["Phanh XOÁ<br/>lệnh xoá luôn phải xin xác nhận"]
        H2["Phanh hàng loạt<br/>sửa quá 20 bản ghi phải xác nhận"]
        H3["Cột cấm tuyệt đối<br/>giá vốn, giá nhập, lãi gộp:<br/>không đọc, không ghi, kể cả nhân viên hỏi"]
        H4["Chặn giá bất thường<br/>230.000đ mà thành 8đ thì hỏi lại,<br/>không cho chốt"]
    end

    subgraph P3 ["2b — Khách KHÔNG đặt được đơn"]
        direction TB
        K1["Khách chỉ có 8 công cụ tra cứu<br/>không có công nợ, không có báo cáo,<br/>không có chiết khấu"]
        K2["Đặt đơn / sửa chiết khấu / xuất kho<br/>là công cụ RIÊNG của nhân viên"]
        K3["Nếu bật cho khách tự chốt:<br/>vẫn có trần tiền 20 triệu một đơn,<br/>vượt thì chuyển người thật"]
    end

    P2 --> OUT1["Ghi vào Odoo"]
    P3 --> OUT1
    OUT1 --> P4
    K1 --> P4

    subgraph P4 ["3 — Chặn SAU khi model soạn câu (chống hứa lèo)"]
        direction TB
        L1["Bot nói 'đã lên đơn / đã cập nhật'<br/>mà chưa hề ghi gì -> chặn"]
        L2["Bot nói 'đã gửi ảnh / hoá đơn'<br/>mà không có ảnh nào -> chặn"]
        L3["Bot nói 'đã gửi tài liệu'<br/>mà không lấy được file nào -> chặn"]
        L4["Bot nói 'đã chuyển nhân viên'<br/>mà chưa gọi ai -> chặn, gọi người thật"]
    end

    P4 --> OUT2["Gửi tin về Zalo"]
    P4 -.->|"bị chặn"| OUT3["Không gửi câu bịa;<br/>báo nhân viên xử lý"]
```

**Chú thích cho lập trình viên:** cổng nhận lệnh `agent/staff-command.ts` +
`luong-nhan-vien.ts:dangChoTraLoiNv` · khoá việc Redis `noi-zalo/khoa-viec.ts`
(100 giây, băm theo nội dung) · trần tin `noi-zalo/gioi-han.ts` · ngân sách
thời gian `noi-zalo/dung.ts:hanGioLuot` + `noi-zalo/ngan-sach.ts` · phanh xoá /
phanh 20 bản ghi / cột cấm `odoo/tong-quat/an-toan.ts` (áp cho 3 tool Odoo tổng
quát: đọc, khám phá, làm) · giá bất thường `gom-don/gia-bat-thuong.ts` · trần
tiền khách `noi-zalo/cong-tac.ts:tranTienKhach` · bốn hàng rào chống hứa lèo
`agent/y-dinh-dung.ts` (`khoeDaGhi`, `khoeDaGuiAnh`, `khoeDaGuiTaiLieu`,
`khoeDaChuyenSale`).
