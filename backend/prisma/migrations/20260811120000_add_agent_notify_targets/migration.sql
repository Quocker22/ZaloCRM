-- NƠI NHẬN THÔNG BÁO khi bot cần người hỗ trợ khách — thay env
-- AI_AGENT_THREAD_BAO_SALE (một nhóm cố định, đổi phải sửa env + restart).
--
-- TƯƠNG THÍCH NGƯỢC: bảng này tạo ra RỖNG. Bảng rỗng → code rơi về env như cũ,
-- prod chạy y nguyên. Chỉ khi admin thêm đích đầu tiên thì DB mới thắng env.
CREATE TABLE "agent_notify_targets" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "ten_goi" TEXT NOT NULL,
    "loai_dich" TEXT NOT NULL DEFAULT 'nhom',
    "thread_id" TEXT NOT NULL,
    "nhan_khach_can_ho_tro" BOOLEAN NOT NULL DEFAULT true,
    "nhan_bot_su_co" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_notify_targets_pkey" PRIMARY KEY ("id")
);

-- Một threadId chỉ khai một lần trong mỗi org — khai hai lần là dội tin đôi.
CREATE UNIQUE INDEX "agent_notify_targets_org_id_thread_id_key" ON "agent_notify_targets"("org_id", "thread_id");
CREATE INDEX "agent_notify_targets_org_id_enabled_idx" ON "agent_notify_targets"("org_id", "enabled");

ALTER TABLE "agent_notify_targets" ADD CONSTRAINT "agent_notify_targets_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
