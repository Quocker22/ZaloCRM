
## 17/08/2026 — trở về đường chính thống

- Nguồn sự thật DUY NHẤT: **Dokploy** (env ở tab Environment, deploy bằng push GitHub → webhook → autoDeploy).
- Đường bundle-qua-SSH + sửa `.env` tay (13–17/08) chỉ là chữa cháy khi Dokploy mất mạng GitHub — **KHÔNG dùng nữa** khi mạng bình thường, vì nó tạo hai nguồn sự thật (Dokploy vs file server) → deploy sau ghi đè lẫn nhau.
- Đổi cấu hình = sửa trên Dokploy → bấm Deploy (hoặc push code). Không sửa `.env` trên server.
