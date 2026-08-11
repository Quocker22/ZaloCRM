// SPDX-License-Identifier: AGPL-3.0-or-later
// LLM — dựng hàm gọi model từ cấu hình per-org.
//
// NGUỒN CẤU HÌNH DUY NHẤT: AiConfig + AppSetting trong DB (cùng nguồn luồng RAG
// cũ). Đổi model/key trên giao diện là cả hai luồng đổi theo — không bao giờ có
// chuyện agent chạy model khác luồng cũ mà không ai biết.
//
// KHÔNG đọc biến LLM_BASE/LLM_KEY/LLM_MODEL: bắt nhập cùng một thứ ở hai nơi là
// mời chúng lệch nhau.
import { prisma } from '../../../../shared/database/prisma-client.js';
import { generateWithOpenaiCompatTools } from '../../providers/openai-compat.js';
import { getProviderApiKey } from '../../ai-service.js';
import { getProviderBaseUrl } from '../../provider-registry.js';
import type { ToolAwareGenerate } from '../types.js';

/**
 * Ghép đường dẫn chat/completions theo provider.
 *
 * PHẢI khớp `ai-service.ts` (luồng RAG cũ) — bug thật 2026-08-04: ghép
 * `${baseUrl}/chat/completions` (thiếu `/v1`) nên gateway trả HTML 404 và MỌI
 * lượt agent rơi về luồng RAG cũ. Log chỉ hiện "lỗi luồng khách" nên nhìn bên
 * ngoài tưởng agent chưa bật. Có test khoá hành vi này (noi-zalo.func.ts).
 */
export function duongDanChat(provider: string, baseUrl: string): string {
  const goc = baseUrl.replace(/\/+$/, '');
  if (provider === 'qwen') return `${goc}/compatible-mode/v1/chat/completions`;
  return `${goc}/v1/chat/completions`;
}

/**
 * Dựng hàm gọi LLM cho một tổ chức. Trả null khi thiếu key/URL — caller dừng
 * có log (luồng nhân viên) hoặc nhường luồng cũ (luồng khách), thay vì ném
 * giữa chừng.
 *
 * LLM_TIMEOUT_MS chỉ dành cho model local chậm (qwen qua Ollama vượt 40s);
 * gateway thật thì để provider tự leo thang 12→20→30→40s.
 */
export async function dungGenerate(
  orgId: string,
  /**
   * MỐC hết hạn tuyệt đối của cả lượt (Date.now() + ngân sách).
   *
   * Truyền ở ĐÂY vì đây là chỗ DUY NHẤT dựng hàm gọi model — phủ mọi đường
   * (máy gom đơn, agent thường, luồng khách) mà không phải sửa từng nơi.
   *
   * Không truyền → hành vi cũ (mỗi lần gọi tự đặt hạn riêng), giữ cho test cũ
   * và các luồng chưa có ngân sách vẫn chạy.
   */
  hanChotMs?: number,
): Promise<ToolAwareGenerate | null> {
  const cfg = await prisma.aiConfig.findUnique({ where: { orgId } });
  if (!cfg) return null;
  const apiKey = await getProviderApiKey(orgId, cfg.provider);
  if (!apiKey) return null;
  const baseUrl = await getProviderBaseUrl(orgId, cfg.provider);
  if (!baseUrl) return null;

  return (a) =>
    generateWithOpenaiCompatTools({
      url: duongDanChat(cfg.provider, baseUrl),
      apiKey,
      model: cfg.model,
      ...(process.env.LLM_TIMEOUT_MS ? { timeoutMs: Number(process.env.LLM_TIMEOUT_MS) } : {}),
      ...(hanChotMs ? { hanChotMs } : {}),
      ...a,
    });
}

/**
 * Cấu hình LLM thô của một tổ chức — cho việc gọi provider KHÔNG qua
 * `ToolAwareGenerate` (hiện là nhìn ảnh: cần gửi content block, không cần tool).
 *
 * Dùng chung nguồn với `dungGenerate` để đổi provider một lần là cả hai theo.
 * Trả URL ĐẦY ĐỦ (đã qua duongDanChat) — caller không tự ghép, tránh /v1 đôi.
 */
export async function layCauHinhLlm(
  orgId: string,
): Promise<{ url: string; apiKey: string; model: string } | null> {
  const cfg = await prisma.aiConfig.findUnique({ where: { orgId } });
  if (!cfg) return null;
  const apiKey = await getProviderApiKey(orgId, cfg.provider);
  if (!apiKey) return null;
  const baseUrl = await getProviderBaseUrl(orgId, cfg.provider);
  if (!baseUrl) return null;
  return { url: duongDanChat(cfg.provider, baseUrl), apiKey, model: cfg.model };
}
