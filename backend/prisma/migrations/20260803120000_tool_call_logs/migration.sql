-- Nhật ký gọi tool của agent: dùng để chẩn đoán khi bot trả lời sai.
CREATE TABLE "tool_call_logs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "vai" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" TEXT NOT NULL,
    "thanh_cong" BOOLEAN NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "iteration" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_call_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tool_call_logs_org_id_created_at_idx" ON "tool_call_logs"("org_id", "created_at");
CREATE INDEX "tool_call_logs_conversation_id_idx" ON "tool_call_logs"("conversation_id");
CREATE INDEX "tool_call_logs_tool_name_idx" ON "tool_call_logs"("tool_name");

ALTER TABLE "tool_call_logs" ADD CONSTRAINT "tool_call_logs_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
