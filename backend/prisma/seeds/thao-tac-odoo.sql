-- Seed việc quen cho tool Odoo tổng quát (spec 2026-08-10).
-- Danh sách theo anh Quốc nêu 10/08: xác nhận/huỷ đơn, thu tiền/công nợ,
-- nhập/xuất/kiểm kho, sửa SP/khách, chiết khấu.
-- Thêm việc mới về sau = INSERT thêm một dòng, KHÔNG cần deploy.
INSERT INTO "thao_tac_odoo" ("id","org_id","ten","mo_ta","bang","viec","nut","ghi_chu") VALUES
 ('tto_xacnhandon','23e58332-cc24-4dc7-9293-d938d5057147','xác nhận đơn','Đơn nháp → xác nhận bán. NV nói: "xác nhận đơn S13823"','sale.order','goi_nut','action_confirm','anh Quốc nêu 10/08'),
 ('tto_huydon','23e58332-cc24-4dc7-9293-d938d5057147','huỷ đơn','Huỷ đơn bán. NV nói: "huỷ đơn S13823"','sale.order','goi_nut','action_cancel','anh Quốc nêu 10/08'),
 ('tto_vaoso_hd','23e58332-cc24-4dc7-9293-d938d5057147','vào sổ hoá đơn','Hoá đơn nháp → vào sổ lấy số. Đã có tool xuat_hoa_don cho ca thường','account.move','goi_nut','action_post','anh Quốc nêu 10/08'),
 ('tto_xacnhankho','23e58332-cc24-4dc7-9293-d938d5057147','xác nhận phiếu kho','Xác nhận phiếu nhập/xuất kho. NV nói: "xác nhận phiếu nhập WH/IN/001"','stock.picking','goi_nut','button_validate','anh Quốc nêu 10/08 (kho)'),
 ('tto_suagiasp','23e58332-cc24-4dc7-9293-d938d5057147','sửa giá bán sản phẩm','NV nói: "sửa giá SP X thành 99k". du_lieu {"list_price": 99000}','product.template','sua',NULL,'anh Quốc nêu 10/08'),
 ('tto_suakhach','23e58332-cc24-4dc7-9293-d938d5057147','sửa thông tin khách','Đổi tên/SĐT/địa chỉ khách. du_lieu {"phone": "090..."}','res.partner','sua',NULL,'anh Quốc nêu 10/08'),
 ('tto_suachietkhau','23e58332-cc24-4dc7-9293-d938d5057147','sửa chiết khấu dòng đơn','du_lieu {"discount": 5} cho dòng đơn. Ca thường đã có sua_chiet_khau','sale.order.line','sua',NULL,'anh Quốc nêu 10/08 (chiết khấu)'),
 ('tto_suasldong','23e58332-cc24-4dc7-9293-d938d5057147','sửa số lượng dòng đơn','du_lieu {"product_uom_qty": 10}. Ca thường đã có sua_don','sale.order.line','sua',NULL,'anh Quốc nêu 10/08'),
 ('tto_taokhach','23e58332-cc24-4dc7-9293-d938d5057147','tạo khách mới','du_lieu {"name": "...", "phone": "..."}. Ca thường đã có tao_khach_hang','res.partner','tao',NULL,'anh Quốc nêu 10/08'),
 ('tto_thanhtoan','23e58332-cc24-4dc7-9293-d938d5057147','ghi nhận thanh toán','Khách trả tiền. du_lieu gồm partner_id, amount, journal_id','account.payment','tao',NULL,'anh Quốc nêu 10/08 (thu tiền/công nợ)')
ON CONFLICT ("org_id","ten") DO NOTHING;
