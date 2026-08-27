// SPDX-License-Identifier: AGPL-3.0-or-later
// e2e Task 5: kiểm chéo TRỌN VÒNG qua WebSocket thật — server (socket.io
// Server + registerAgentWs + AgentRegistry) nối với 1 agent GIẢ dùng
// socket.io-client THẬT, rồi chayMotLuotIn (hàng đợi, hang-doi-in.ts) chạy
// với AgentClient THẬT bọc registry đó.
//
// VÌ SAO cần test này dù từng mảnh đã có test riêng (agent-registry.func.ts,
// agent-ws.func.ts, agent-client.func.ts, hang-doi-in.func.ts): mỗi test đó
// cô lập một tầng — không tầng nào tự chạy thử "1 job cho_in thật sự chạy
// hết đường ống, qua đúng dây WS, tới đúng agent, và job DB đổi đúng trạng
// thái" (bài học "kiểm chéo sau nhiều subagent" — test riêng xanh vẫn có thể
// triệt tiêu nhau ở chỗ nối). Đây là bài kiểm chéo đó cho PHẦN 1.
//
// Prisma giả giữ hàng trong RAM — copy nguyên cách làm của hang-doi-in.func.ts
// (không phải Prisma thật, đây là test func không phải test:db).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { Server as IoServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { registerAgentWs } from '../../../src/modules/ai/may-in/agent-ws.js';
import { AgentRegistry } from '../../../src/modules/ai/may-in/agent-registry.js';
import { AgentClient } from '../../../src/modules/ai/may-in/agent-client.js';
import { chayMotLuotIn, type PrismaHangDoiIn, type JobIn } from '../../../src/modules/ai/may-in/hang-doi-in.js';

const TOKEN_DUNG = 'token-e2e-agent-test';
const ORG_ID = 'org-e2e';

/** Prisma giả giữ hàng trong RAM — bề mặt tối thiểu chayMotLuotIn cần. */
function prismaGia(hangSan: Array<Partial<JobIn>>) {
  let dem = 0;
  const hang: JobIn[] = hangSan.map((h) => ({
    id: h.id ?? `j${++dem}`,
    orgId: ORG_ID,
    conversationId: null,
    hoaDonId: 7001,
    soHoaDon: 'INV/2026/00099',
    report: 'incokit_pos.report_invoice_document_kiotviet',
    trangThai: 'cho_in',
    lanThu: 0,
    ippJobId: null,
    loiCuoi: null,
    ...h,
  } as JobIn));
  const prisma: PrismaHangDoiIn = {
    printJob: {
      create: async ({ data }) => {
        const j = { id: `j${++dem}`, ippJobId: null, loiCuoi: null, conversationId: null, ...data } as JobIn;
        hang.push(j);
        return j;
      },
      findMany: async ({ where }) => {
        const muon = (where?.trangThai as { in?: string[] })?.in;
        return hang.filter((j) => !muon || muon.includes(j.trangThai)).map((j) => ({ ...j }));
      },
      update: async ({ where, data }) => {
        const j = hang.find((x) => x.id === where.id)!;
        Object.assign(j, data);
        return { ...j };
      },
    },
  };
  return { prisma, hang };
}

describe('e2e: server↔agent giả trọn vòng qua WebSocket (Task 5, phần 1)', () => {
  let httpServer: HttpServer;
  let io: IoServer;
  let registry: AgentRegistry;
  let port: number;
  const clients: ClientSocket[] = [];

  beforeEach(async () => {
    process.env.AI_MAY_IN_AGENT_TOKEN = TOKEN_DUNG;
    httpServer = createServer();
    io = new IoServer(httpServer);
    registry = new AgentRegistry();
    registerAgentWs(io, registry);
    await new Promise<void>((resolve) => httpServer.listen(0, () => resolve()));
    const addr = httpServer.address();
    if (addr && typeof addr === 'object') port = addr.port;
  });

  afterEach(async () => {
    for (const c of clients) c.disconnect();
    clients.length = 0;
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    delete process.env.AI_MAY_IN_AGENT_TOKEN;
  });

  /** Kết nối 1 agent GIẢ — nhận job, luôn trả 'da_in' kèm bản ghi job nhận được. */
  function ketNoiAgentGia(): { socket: ClientSocket; jobsNhanDuoc: Promise<any> } {
    const c = ioClient(`http://localhost:${port}/print-agent`, {
      auth: { token: TOKEN_DUNG, orgId: ORG_ID },
      reconnection: false,
      transports: ['websocket'],
    });
    clients.push(c);
    const jobsNhanDuoc = new Promise<any>((resolve) => {
      c.on('job', (msg: any) => {
        // Agent giả "in xong ngay" — báo kết quả qua đúng sự kiện 'ket-qua'
        // mà agent-ws.ts lắng nghe (xem agent-ws.ts dòng ~59).
        c.emit('ket-qua', { jobId: msg.job.id, trangThai: 'da_in' });
        resolve(msg);
      });
    });
    return { socket: c, jobsNhanDuoc };
  }

  it('job cho_in → agent giả nhận đúng pdfBase64+A5+tray-2 → job DB thành da_in', async () => {
    const { prisma, hang } = prismaGia([{}]);
    const { jobsNhanDuoc } = ketNoiAgentGia();
    await new Promise<void>((resolve, reject) => {
      clients[0].on('connect', () => resolve());
      clients[0].on('connect_error', (err) => reject(err));
    });

    const client = new AgentClient(registry, ORG_ID, { paperSize: 'A5', tray: 'tray-2' });
    const pdfGoc = Buffer.from('%PDF-1.4 noi-dung-hoa-don-that');
    const taiPdf = async () => pdfGoc;

    await chayMotLuotIn({ prisma, client, taiPdf });

    const msg = await jobsNhanDuoc;
    expect(msg).toMatchObject({
      loai: 'in',
      job: {
        paperSize: 'A5',
        tray: 'tray-2',
        pdfBase64: pdfGoc.toString('base64'),
      },
    });

    // Fix round 1 (review): AgentClient in ĐỒNG BỘ — registry.guiJob() chỉ
    // resolve SAU KHI agent đã báo 'da_in' qua WS, tức máy in vật lý ĐÃ IN
    // XONG THẬT ngay tại đây. inPdf() trả daInXong:true nên chayMotLuotIn ghi
    // THẲNG da_in, không đi qua da_gui chờ xác minh (khác IPP — bất đồng bộ,
    // 2 nhịp: gửi xong → lượt cron sau mới xác minh xong hay chưa). Nếu vẫn
    // dừng ở da_gui thì job sẽ KẸT VĨNH VIỄN vì ippJobId luôn null khiến
    // xacMinh() đứng yên mãi — đó chính là bug đã được vá.
    expect(hang[0].trangThai).toBe('da_in');
    expect(hang[0].ippJobId).toBeNull();
    expect(hang[0].loiCuoi).toBeNull();
  });

  it('2 job cho_in tuần tự → cả 2 đều tới đúng agent giả và job DB đều thành da_in', async () => {
    const { prisma, hang } = prismaGia([{ soHoaDon: 'INV/A' }, { soHoaDon: 'INV/B' }]);
    const nhanDuoc: any[] = [];
    const c = ioClient(`http://localhost:${port}/print-agent`, {
      auth: { token: TOKEN_DUNG, orgId: ORG_ID },
      reconnection: false,
      transports: ['websocket'],
    });
    clients.push(c);
    c.on('job', (msg: any) => {
      nhanDuoc.push(msg);
      c.emit('ket-qua', { jobId: msg.job.id, trangThai: 'da_in' });
    });
    await new Promise<void>((resolve, reject) => {
      c.on('connect', () => resolve());
      c.on('connect_error', (err) => reject(err));
    });

    const client = new AgentClient(registry, ORG_ID, { paperSize: 'A5', tray: 'tray-2' });
    await chayMotLuotIn({ prisma, client, taiPdf: async () => Buffer.from('%PDF') });

    expect(nhanDuoc).toHaveLength(2);
    expect(hang.map((j) => j.trangThai)).toEqual(['da_in', 'da_in']);
    expect(hang.map((j) => j.soHoaDon).sort()).toEqual(['INV/A', 'INV/B']);
  });

  it('không agent online → chayMotLuotIn để job cho_in retry (lanThu+1), không quăng lỗi ra ngoài', async () => {
    const { prisma, hang } = prismaGia([{}]);
    // KHÔNG kết nối agent giả nào — registry rỗng.
    const client = new AgentClient(registry, ORG_ID, { paperSize: 'A5', tray: 'tray-2' });
    await chayMotLuotIn({ prisma, client, taiPdf: async () => Buffer.from('%PDF') });
    expect(hang[0]).toMatchObject({ trangThai: 'cho_in', lanThu: 1 });
    expect(hang[0].loiCuoi).toMatch(/agent/i);
  });
});
