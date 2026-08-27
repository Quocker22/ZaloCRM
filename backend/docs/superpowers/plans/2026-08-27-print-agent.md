# Print Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** In hoá đơn qua agent Rust ở máy shop (nhận job qua WebSocket, in qua driver HP), bỏ Tailscale + SSH tunnel + socket-proxy.

**Architecture:** Server (ZaloCRM .28) render PDF rồi đẩy job qua WebSocket cho agent. Agent Rust (Windows Service ở shop) tự nối ra server, nhận PDF, in qua winspool/driver HP (chọn khay A5). Giữ nguyên bảng print_jobs + hàng đợi + luật A3; chỉ THAY "cách gửi" (IppClient → AgentClient cùng interface ClientMayIn).

**Tech Stack:** Backend TS (fastify + socket.io + prisma, vitest). Agent: Rust (tokio-tungstenite WS, printers/winspool, windows-service).

**Spec:** docs/superpowers/specs/2026-08-27-print-agent-design.md

## Global Constraints
- Interface `ClientMayIn` (hang-doi-in.ts) BẤT BIẾN: `inPdf(pdf,tenJob)→{jobId,phanHoi}`, `traTrangThaiJob(jobId)→{jobState,phanHoi}`. AgentClient phải khớp để chayMotLuotIn không đổi.
- Luật A3 GIỮ NGUYÊN: lỗi rõ→retry, lỗi không rõ (đã gửi mất phản hồi)→khong_ro cấm gửi mù.
- Agent token RIÊNG (env AI_MAY_IN_AGENT_TOKEN), KHÔNG phải JWT user. Chỉ quyền nhận job + báo kết quả.
- Test 2 suite: `npx vitest run` (unit) + `npx vitest run --config vitest.func.config.ts` (func).
- Commit cuối mỗi task. SPDX header + Co-Authored-By: Claude Fable 5 + Claude-Session.

---

# PHẦN 1 — Server-side (test được không cần Rust)

### Task 1: Registry agent kết nối (agent-registry.ts)
Quản lý agent đang online: 1 agent/org, gửi job + chờ kết quả theo id.

**Files:**
- Create: `backend/src/modules/ai/may-in/agent-registry.ts`
- Test: `backend/tests/ai/may-in/agent-registry.func.ts`

**Interfaces:**
- Produces: `class AgentRegistry { dangKy(orgId, gui:(msg)=>void): ()=>void; coAgent(orgId): boolean; guiJob(orgId, job): Promise<KetQuaAgent>; nhanKetQua(jobId, kq): void }`
  - `job = { id:string, pdfBase64:string, paperSize:string, tray:string, copies:number }`
  - `KetQuaAgent = { trangThai:'da_in'|'loi', loiCuoi?:string }` — resolve khi agent báo, reject nếu timeout/agent rớt.

- [ ] **Step 1: Test — dangKy rồi coAgent = true; huỷ đăng ký → false**
```ts
import { AgentRegistry } from '../../../src/modules/ai/may-in/agent-registry.js';
it('đăng ký agent rồi thấy online, huỷ thì offline', () => {
  const r = new AgentRegistry();
  const huy = r.dangKy('org1', () => {});
  expect(r.coAgent('org1')).toBe(true);
  huy();
  expect(r.coAgent('org1')).toBe(false);
});
```
- [ ] **Step 2: Chạy test → FAIL (module chưa có)**
Run: `npx vitest run --config vitest.func.config.ts tests/ai/may-in/agent-registry.func.ts`
- [ ] **Step 3: Test — guiJob gọi hàm gui của agent với đúng job, nhanKetQua resolve**
```ts
it('guiJob đẩy job cho agent và resolve khi có kết quả', async () => {
  const r = new AgentRegistry();
  let daGui: any = null;
  r.dangKy('org1', (msg) => { daGui = msg; });
  const p = r.guiJob('org1', { id: 'j1', pdfBase64: 'AAAA', paperSize: 'A5', tray: 'tray-2', copies: 1 });
  expect(daGui).toMatchObject({ loai: 'in', job: { id: 'j1', paperSize: 'A5' } });
  r.nhanKetQua('j1', { trangThai: 'da_in' });
  await expect(p).resolves.toEqual({ trangThai: 'da_in' });
});
```
- [ ] **Step 4: Test — agent rớt giữa chừng (huỷ đăng ký) → guiJob đang chờ bị reject LoiKhongRo**
```ts
it('agent rớt khi đang chờ kết quả → reject để hàng đợi vào khong_ro', async () => {
  const r = new AgentRegistry();
  const huy = r.dangKy('org1', () => {});
  const p = r.guiJob('org1', { id: 'j2', pdfBase64: 'A', paperSize: 'A5', tray: 'tray-2', copies: 1 });
  huy();
  await expect(p).rejects.toThrow(/agent/i);
});
```
- [ ] **Step 5: Test — không có agent online → guiJob reject ngay (LoiIpp guiDuoc=false tương đương)**
```ts
it('không agent → reject "chưa gửi được"', async () => {
  const r = new AgentRegistry();
  await expect(r.guiJob('org1', { id: 'j3', pdfBase64: 'A', paperSize: 'A5', tray: 'tray-2', copies: 1 })).rejects.toThrow();
});
```
- [ ] **Step 6: Implement agent-registry.ts (Map orgId→{gui, chờ:Map jobId→{resolve,reject}}). guiJob: chưa agent→reject; có→gui+tạo promise chờ nhanKetQua; huỷ đăng ký→reject mọi promise đang chờ của agent đó.**
- [ ] **Step 7: Chạy 4 test → PASS**
- [ ] **Step 8: Commit** `feat(may-in): agent-registry — quản lý agent WS + gửi job chờ kết quả`

### Task 2: AgentClient khớp interface ClientMayIn (agent-client.ts)
Bọc AgentRegistry thành ClientMayIn để chayMotLuotIn dùng thay IppClient — KHÔNG đổi hàng đợi.

**Files:**
- Create: `backend/src/modules/ai/may-in/agent-client.ts`
- Test: `backend/tests/ai/may-in/agent-client.func.ts`

**Interfaces:**
- Consumes: `AgentRegistry` (Task 1); `LoiIpp`, `LoiKhongRo` (ipp-client.ts).
- Produces: `class AgentClient implements ClientMayIn` — constructor(registry, orgId, {paperSize,tray}). `inPdf(pdf,tenJob)`: guiJob(pdfBase64) → da_in trả {jobId:1,...}; reject "chưa agent"→ throw LoiIpp(guiDuoc=false); reject "agent rớt"→ throw LoiKhongRo; loi→ throw LoiIpp(guiDuoc=true). `traTrangThaiJob`: agent không có khái niệm job-id máy in → trả {jobState:null} (hàng đợi giữ nguyên trạng thái, không tự chuyển).

- [ ] **Step 1: Test — inPdf gọi guiJob, da_in → không ném**
```ts
it('agent in xong → inPdf trả về bình thường', async () => {
  const reg = { guiJob: vi.fn(async () => ({ trangThai: 'da_in' })) } as any;
  const c = new AgentClient(reg, 'org1', { paperSize: 'A5', tray: 'tray-2' });
  await c.inPdf(Buffer.from('%PDF'), 'INV/1');
  expect(reg.guiJob).toHaveBeenCalledWith('org1', expect.objectContaining({ paperSize: 'A5', tray: 'tray-2' }));
});
```
- [ ] **Step 2: Chạy → FAIL**
- [ ] **Step 3: Test — reject "chưa agent" → LoiIpp guiDuoc=false (retry an toàn)**
```ts
it('không agent → LoiIpp guiDuoc=false', async () => {
  const reg = { guiJob: vi.fn(async () => { throw new Error('không có agent'); }) } as any;
  const c = new AgentClient(reg, 'org1', { paperSize: 'A5', tray: 'tray-2' });
  const e = await c.inPdf(Buffer.from('%PDF'), 'x').catch(x=>x);
  expect(e).toBeInstanceOf(LoiIpp); expect(e.guiDuoc).toBe(false);
});
```
- [ ] **Step 4: Test — reject "agent rớt" → LoiKhongRo (A3: cấm gửi mù)**
```ts
it('agent rớt khi đang in → LoiKhongRo', async () => {
  const reg = { guiJob: vi.fn(async () => { throw new Error('agent rớt giữa chừng'); }) } as any;
  const c = new AgentClient(reg, 'org1', { paperSize: 'A5', tray: 'tray-2' });
  await expect(c.inPdf(Buffer.from('%PDF'), 'x')).rejects.toBeInstanceOf(LoiKhongRo);
});
```
- [ ] **Step 5: Implement agent-client.ts. Phân loại lỗi theo message registry ném (khớp Task 1: "không có agent"→false, "agent rớt"→LoiKhongRo, còn lại loi→LoiIpp true). pdf→base64.**
- [ ] **Step 6: Chạy → PASS**
- [ ] **Step 7: Commit** `feat(may-in): agent-client khớp ClientMayIn — hàng đợi dùng chung, luật A3 giữ nguyên`

### Task 3: WebSocket endpoint cho agent (agent-ws.ts)
Namespace/route socket.io riêng cho agent, auth bằng AI_MAY_IN_AGENT_TOKEN, nối vào AgentRegistry.

**Files:**
- Create: `backend/src/modules/ai/may-in/agent-ws.ts`
- Modify: `backend/src/app.ts` (gọi registerAgentWs(io) sau registerSocketAuth)
- Test: `backend/tests/ai/may-in/agent-ws.func.ts`

**Interfaces:**
- Consumes: `AgentRegistry` (Task 1), `Server` từ socket.io.
- Produces: `registerAgentWs(io: Server, registry: AgentRegistry): void` — namespace `/print-agent`; connect phải kèm `auth.token === env.AI_MAY_IN_AGENT_TOKEN` và `auth.orgId`, sai token→disconnect; connect ok→registry.dangKy(orgId, msg=>socket.emit('job',msg)); socket.on('ket-qua', {jobId,trangThai,loiCuoi}→registry.nhanKetQua); disconnect→huỷ đăng ký.

- [ ] **Step 1: Test — token đúng kết nối được + coAgent=true; token sai bị đá**
(dùng socket.io Server + socket.io-client thật trên cổng ngẫu nhiên, KHÔNG mock)
```ts
it('agent token đúng → registry.coAgent(org) = true', async () => { /* dựng io, connect client với auth.token đúng, chờ, expect registry.coAgent('org1') */ });
it('token sai → bị disconnect, không đăng ký', async () => { /* auth.token sai → connect_error hoặc disconnect */ });
```
- [ ] **Step 2: Chạy → FAIL**
- [ ] **Step 3: Test — agent gửi ket-qua → registry.nhanKetQua được gọi**
- [ ] **Step 4: Implement agent-ws.ts + wiring app.ts. env AI_MAY_IN_AGENT_TOKEN thiếu→không đăng ký namespace (log cảnh báo).**
- [ ] **Step 5: Chạy → PASS**
- [ ] **Step 6: Commit** `feat(may-in): WebSocket endpoint /print-agent, auth token riêng`

### Task 4: Đấu AgentClient vào cron may-in (thay IppClient)
Cron: có agent online → dùng AgentClient render+đẩy; giữ IppClient làm fallback sau env cờ (mặc định agent).

**Files:**
- Modify: `backend/src/modules/ai/may-in/cron.ts`
- Modify: `backend/src/modules/ai/may-in/tu-env.ts` (thêm đọc AI_MAY_IN_AGENT_TOKEN, cờ chọn agent vs ipp)
- Test: `backend/tests/ai/may-in/cron-agent.func.ts` (nếu tách được logic chọn client ra hàm thuần)

**Interfaces:**
- Consumes: AgentClient (Task 2), AgentRegistry (Task 1), ippConfigTuEnv.
- Produces: hàm `chonClientMayIn(deps) : ClientMayIn` — có AI_MAY_IN_AGENT_TOKEN → AgentClient(registry); else có AI_MAY_IN_IPP_URL → IppClient; else null (không bật cron).

- [ ] **Step 1: Test hàm chonClientMayIn: có agent token → trả AgentClient; chỉ có ipp url → IppClient; không gì → null**
- [ ] **Step 2: Chạy → FAIL**
- [ ] **Step 3: Implement chonClientMayIn + sửa startMayInCron dùng nó; AgentRegistry là singleton chia sẻ với agent-ws.**
- [ ] **Step 4: Chạy → PASS + full func suite không vỡ**
- [ ] **Step 5: Commit** `feat(may-in): cron chọn AgentClient khi có agent token, IPP làm fallback`

### Task 5: Kiểm chéo PHẦN 1 — e2e server với agent giả
- [ ] **Step 1: Test e2e: dựng io + registerAgentWs + AgentRegistry, connect 1 agent giả (socket.io-client) trả 'da_in'; tạo 1 print_job cho_in; chạy chayMotLuotIn với AgentClient thật → job thành da_in, agent nhận đúng pdfBase64+A5+tray-2.**
- [ ] **Step 2: Chạy → PASS**
- [ ] **Step 3: `npx tsc --noEmit` + cả 2 suite test xanh**
- [ ] **Step 4: Commit** `test(may-in): e2e server-agent giả — job chạy trọn vòng qua WebSocket`

---

# PHẦN 2 — Agent Rust (làm sau khi PHẦN 1 xanh)

Thư mục mới `print-agent/` (Cargo). KHÔNG nằm trong backend TS.
- Task 6: scaffold Cargo + config (server_url, token, orgId, printer_name, tray) đọc từ file.
- Task 7: WS client (tokio-tungstenite) nối server, auth, nhận 'job', gửi 'ket-qua'. Test bằng server WS giả trong Rust.
- Task 8: in PDF qua winspool (crate `printers` hoặc gọi SumatraPDF) với paper size + tray. Dry-run: ghi PDF ra file trước; test in thật ra máy.
- Task 9: đóng Windows Service (windows-service crate) + build release .exe.
Chi tiết từng task viết sau khi PHẦN 1 chạy thật (cần biết chính xác message shape đã chốt).

---

# PHẦN 3 — Gỡ hạ tầng cũ (sau khi agent chạy ổn định vài ngày)
- Task 10: gỡ socket-proxy systemd + SSH tunnel authorized_keys trên .28.
- Task 11: gỡ NSSM service SSH + Tailscale trên máy shop.
- Task 12: gỡ IppClient/socket-proxy code nếu không giữ làm fallback.
Mỗi bước có rollback; chỉ làm khi agent đã in ổn định.
