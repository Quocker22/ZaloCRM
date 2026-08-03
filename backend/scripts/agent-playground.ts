// SPDX-License-Identifier: AGPL-3.0-or-later
// Sân chơi thử bot — web UI 2 VAI, chạy độc lập, KHÔNG cần Zalo thật.
//
//   Vai KHÁCH    → bot tư vấn (tra giá/tồn, chuyển sale khi khách muốn mua)
//   Vai NHÂN VIÊN → bot làm việc (tra + LÊN ĐƠN, cần tag @bot)
//
// Giả lập hội thoại Zalo mà không phải quét QR, không rủi ro khóa nick. Đơn tạo
// ra là DRAFT trong Odoo local.
//
// Chạy:
//   LLM_BASE=... LLM_KEY=... LLM_MODEL=... \
//   ODOO_URL=http://localhost:8069 ODOO_DB=nelia_prod \
//   ODOO_USERNAME=admin ODOO_PASSWORD=admin \
//     npx tsx scripts/agent-playground.ts
//   → mở http://localhost:4545

import { createServer } from 'node:http';
import { OdooClient } from '../src/modules/ai/odoo/client.js';
import { HoaDonAnhClient } from '../src/modules/ai/odoo/hoa-don-anh.js';
import { searchKnowledge } from '../src/modules/ai/knowledge/knowledge-service.js';
import { generateEmbedding } from '../src/modules/ai/knowledge/embedding.js';
import { chayLenhNhanVien, type ToolCallLog } from '../src/modules/ai/agent/staff-agent.js';
import { chayTuVanKhach } from '../src/modules/ai/agent/customer-agent.js';
import { generateWithAnthropicTools } from '../src/modules/ai/providers/anthropic.js';
import { generateWithOpenaiCompatTools } from '../src/modules/ai/providers/openai-compat.js';
import type { ToolAwareGenerate } from '../src/modules/ai/agent/types.js';

const PORT = Number(process.env.PORT ?? 4545);
const LLM_BASE = process.env.LLM_BASE ?? 'http://localhost:11434/v1';
const LLM_KEY = process.env.LLM_KEY ?? process.env.OPENAI_API_KEY ?? 'sk-noop';
const LLM_MODEL = process.env.LLM_MODEL ?? 'gpt-4o-mini';
const LLM_KIND = process.env.LLM_KIND ?? 'openai';
const BIZ = 'LEDNELIA - shop đèn LED & phụ kiện điện';

for (const k of ['ODOO_URL', 'ODOO_DB', 'ODOO_USERNAME', 'ODOO_PASSWORD']) {
  if (!process.env[k]) {
    console.error(`Thiếu biến môi trường: ${k}`);
    process.exit(1);
  }
}

const odoo = new OdooClient({
  url: process.env.ODOO_URL!,
  db: process.env.ODOO_DB!,
  username: process.env.ODOO_USERNAME!,
  password: process.env.ODOO_PASSWORD!,
});

// Render ảnh hóa đơn — dùng phiên web riêng (XML-RPC không render PDF được).
const anhClient = new HoaDonAnhClient({
  url: process.env.ODOO_URL!,
  db: process.env.ODOO_DB!,
  username: process.env.ODOO_USERNAME!,
  password: process.env.ODOO_PASSWORD!,
});

/**
 * Tra tài liệu kỹ thuật — dùng lại hạ tầng tri thức sẵn có của hệ.
 *
 * Nạp trễ (lazy): playground phải chạy được cả khi KHÔNG có Postgres. Thiếu DB
 * hoặc thiếu embedding server thì tool `tra_tri_thuc` đơn giản không được đăng
 * ký, bot không hứa tra tài liệu rồi không tra được.
 */
const EMBED_CFG = {
  provider: process.env.EMBED_PROVIDER ?? 'local',
  model: process.env.EMBED_MODEL ?? 'bge-m3',
  baseUrl: process.env.EMBED_BASE_URL ?? 'http://localhost:11434/v1',
};

let timDoanTriThuc:
  | ((cauHoi: string, soDoan: number) => Promise<Array<{ content: string; score?: number }>>)
  | undefined;

async function chuanBiTriThuc(): Promise<string> {
  if (!process.env.DATABASE_URL) return 'tắt (thiếu DATABASE_URL)';
  try {
    const { prisma } = await import('../src/shared/database/prisma-client.js');
    const org = await prisma.organization.findFirst({ select: { id: true } });
    if (!org) return 'tắt (chưa có tổ chức nào)';
    const soChunk = await prisma.knowledgeChunk.count({ where: { orgId: org.id } });
    if (soChunk === 0) return 'tắt (chưa nạp tài liệu — chạy scripts/nap-tri-thuc.ts)';

    timDoanTriThuc = async (cauHoi, soDoan) => {
      const hits = await searchKnowledge(
        { prisma, embed: generateEmbedding } as never,
        org.id, cauHoi, soDoan, EMBED_CFG,
      );
      return hits.map((h) => ({ content: h.content, score: h.score }));
    };
    return `${soChunk} chunk`;
  } catch (err) {
    return `tắt (${err instanceof Error ? err.message.slice(0, 60) : 'lỗi'})`;
  }
}

const generate: ToolAwareGenerate = async (a) =>
  LLM_KIND === 'anthropic'
    ? generateWithAnthropicTools({ baseUrl: LLM_BASE, apiKey: LLM_KEY, model: LLM_MODEL, ...a })
    : generateWithOpenaiCompatTools({
        url: `${LLM_BASE}/chat/completions`, apiKey: LLM_KEY, model: LLM_MODEL, ...a,
      });

/** Đơn nháp đã tạo trong phiên — để dọn hàng loạt. */
const donDaTao = new Set<number>();

interface LuotVao {
  vai: 'khach' | 'nhanvien';
  noiDung: string;
  conversationId: string;
  seq: number;
  history?: Array<{ vai: 'khach' | 'shop'; noiDung: string }>;
}

async function xuLy(v: LuotVao) {
  const log: ToolCallLog[] = [];
  const chuyenSale: string[] = [];
  const t0 = Date.now();
  const ghiNhanChuyenSale = async (yc: { lyDo: string; tomTat: string }) => {
    chuyenSale.push(`${yc.lyDo}: ${yc.tomTat}`);
  };
  const ghiLog = (l: ToolCallLog) => { log.push(l); };

  let kq: Record<string, unknown>;

  if (v.vai === 'khach') {
    // KHÔNG truyền anhClient cho luồng khách: hóa đơn in DƯ NỢ của khách.
    const r = await chayTuVanKhach(
      { odoo, generate, ghiNhanChuyenSale, ghiLog, timDoanTriThuc },
      { bizName: BIZ, message: v.noiDung, history: v.history },
    );
    kq = { ...r };
    // Ảnh SP: đọc file rồi đổi sang data URL — mô phỏng đúng thứ Zalo đính kèm.
    if (r.trangThai === 'xong' && r.anhSanPham) {
      try {
        const { readFileSync } = await import('node:fs');
        const b = readFileSync(r.anhSanPham);
        const ext = r.anhSanPham.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
        kq.anhSanPham = `data:image/${ext};base64,${b.toString('base64')}`;
      } catch { /* ảnh lỗi KHÔNG được làm hỏng câu trả lời */ }
    }
  } else {
    const r = await chayLenhNhanVien(
      { odoo, generate, ghiNhanChuyenSale, ghiLog, anhClient, odooUrl: process.env.ODOO_URL!, timDoanTriThuc },
      {
        bizName: BIZ,
        conversationId: v.conversationId,
        seq: v.seq,
        message: { content: v.noiDung, isSelf: true },
        // UI dùng nhãn khach/shop cho cả 2 vai; luồng nhân viên cần nhanvien/bot.
        history: v.history?.map((h) => ({
          vai: h.vai === 'khach' ? ('nhanvien' as const) : ('bot' as const),
          noiDung: h.noiDung,
        })),
      },
    );
    kq = { ...r };
    // Buffer KHÔNG serialize sang JSON được (thành {type:'Buffer',data:[...]}).
    // Đổi sang data URL để trình duyệt hiện thẳng — đây là bản mô phỏng những
    // gì Zalo sẽ đính kèm.
    if (r.trangThai === 'xong' && r.hoaDon) {
      kq.hoaDon = {
        maDon: r.hoaDon.maDon,
        link: r.hoaDon.link,
        tongTien: r.hoaDon.tongTien,
        tenKhach: r.hoaDon.tenKhach,
        anhDataUrl: r.hoaDon.anh
          ? `data:image/png;base64,${r.hoaDon.anh.duLieu.toString('base64')}`
          : null,
        loiAnh: r.hoaDon.loiAnh ?? null,
      };
    }
    // Ghi nhận đơn mới để dọn được.
    try {
      const don = await odoo.searchRead<{ id: number }>(
        'sale.order', [['client_order_ref', 'like', `zalo:${v.conversationId}:%`]], ['id'],
      );
      don.forEach((d) => donDaTao.add(d.id));
    } catch { /* bỏ qua */ }
  }

  return { ...kq, log, chuyenSale, giay: ((Date.now() - t0) / 1000).toFixed(1) };
}

const HTML = `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Thử bot bán hàng</title><style>
*{box-sizing:border-box}
body{margin:0;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  background:#0f1115;color:#e6e8ec;display:flex;flex-direction:column;height:100vh}
header{padding:10px 18px;background:#161922;border-bottom:1px solid #262b36;
  display:flex;gap:14px;align-items:center;flex-wrap:wrap}
h1{font-size:15px;margin:0;font-weight:600}
.meta{font-size:12px;color:#8b93a7}
.meta b{color:#c9d1e0;font-weight:500}
button{background:#2d3242;color:#e6e8ec;border:1px solid #3a4152;border-radius:6px;
  padding:6px 12px;font-size:13px;cursor:pointer}
button:hover{background:#363c4e}
.tabs{display:flex;gap:0;background:#12151d;border-bottom:1px solid #262b36}
.tab{flex:1;padding:12px;text-align:center;cursor:pointer;font-size:14px;
  border-bottom:2px solid transparent;color:#8b93a7}
.tab.on{color:#e6e8ec;border-bottom-color:#2f6fbf;background:#161922}
.tab small{display:block;font-size:11px;color:#6b7383;margin-top:2px}
#log{flex:1;min-height:0;overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:12px}
.turn{border:1px solid #262b36;border-radius:10px;flex-shrink:0}
.turn>*:first-child{border-radius:10px 10px 0 0}
.turn>*:last-child{border-radius:0 0 10px 10px}
.you{background:#1b2030;padding:10px 14px;font-weight:500}
.you.kh{background:#1a2b22}
.you::before{content:attr(data-vai) " ";color:#7c8db5;font-weight:400}
.tools{background:#12151d;padding:4px 0;border-top:1px solid #262b36}
.tool{padding:7px 14px;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;
  border-left:3px solid #3d7f5d;margin:3px 0}
.tool.err{border-left-color:#c04a4a}
.tool .nm{color:#79c0a0;font-weight:600}
.tool.err .nm{color:#e08a8a}
.tool .in{color:#8b93a7}
.tool .out{color:#aab3c5;white-space:pre-wrap;margin-top:4px;
  max-height:220px;overflow-y:auto;font-size:12px;word-break:break-word}
.reply{background:#141822;padding:12px 14px;border-top:1px solid #262b36;
  white-space:pre-wrap;word-break:break-word}
.reply.kh{background:#12211a}
.warn{background:#2a1f14;border-top:1px solid #4a3520;padding:10px 14px;color:#e0b877}
.hoadon{background:#101620;border-top:1px solid #262b36;padding:12px 14px}
.hoadon img{max-width:100%;border-radius:8px;display:block;background:#fff}
.hoadon a{display:inline-block;margin-top:10px;color:#7fb3f0;text-decoration:none;
  font-size:13px;border:1px solid #2f4a6b;border-radius:6px;padding:7px 13px}
.hoadon a:hover{background:#17263a}
.stat{padding:8px 14px;font-size:12px;color:#7c8493;background:#0f1218;
  border-top:1px solid #262b36;display:flex;gap:16px;flex-wrap:wrap}
form{display:flex;gap:10px;padding:14px 18px;background:#161922;border-top:1px solid #262b36}
input{flex:1;background:#0f1218;border:1px solid #333a49;color:#e6e8ec;
  border-radius:7px;padding:11px 14px;font-size:14px}
input:focus{outline:none;border-color:#4a86c5}
.send{background:#2f6fbf;border-color:#2f6fbf;padding:11px 22px}
.send:hover{background:#3a7fd0}
.send:disabled{opacity:.5;cursor:default}
.hint{padding:0 18px 10px;font-size:12px;color:#6b7383}
.hint code{background:#1b2030;padding:2px 6px;border-radius:4px;cursor:pointer;
  color:#9db4d8;margin-right:4px;display:inline-block;margin-top:4px}
.hint code:hover{background:#252c3d}
</style></head><body>
<header>
  <h1>Thử bot bán hàng</h1>
  <span class="meta">LLM <b id="m"></b> · Odoo <b id="d"></b></span>
  <button onclick="reset()">Hội thoại mới</button>
  <button onclick="donDon()">Dọn đơn thử</button>
</header>
<div class="tabs">
  <div class="tab on" id="t-khach" onclick="setVai('khach')">Vai KHÁCH
    <small>bot tư vấn · không tạo đơn</small></div>
  <div class="tab" id="t-nv" onclick="setVai('nhanvien')">Vai NHÂN VIÊN
    <small>cần tag @bot · được lên đơn</small></div>
</div>
<div id="log"></div>
<div class="hint" id="hint"></div>
<form onsubmit="return gui(event)">
  <input id="i" autocomplete="off" autofocus>
  <button class="send" id="b">Gửi</button>
</form>
<script>
let vai = 'khach', conv = 'ui-' + Date.now(), seq = 0;
const history = [];   // { vai:'khach'|'shop', noiDung } — chỉ dùng cho vai KHÁCH
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));

const GOI_Y = {
  khach: ['đèn led ngoài trời giá bao nhiêu', 'còn hàng 2709-12V-W không',
          'cho mình xin giá sỉ', 'mình lấy 10 cái nhé', 'giá vốn bao nhiêu'],
  nhanvien: ['@bot tra giá đèn COB', '@bot kiểm tra tồn kho 2709-12V-W',
             '@bot lên đơn 5 cái 2709-12V-W cho khách 0986921126'],
};

fetch('/info').then(r=>r.json()).then(d=>{ $('#m').textContent=d.model; $('#d').textContent=d.db; });

function setVai(v){
  vai = v;
  $('#t-khach').classList.toggle('on', v==='khach');
  $('#t-nv').classList.toggle('on', v==='nhanvien');
  $('#i').placeholder = v==='khach' ? 'Gõ như khách hàng…' : 'Gõ lệnh có tag @bot…';
  renderHint(); reset();
}
function renderHint(){
  $('#hint').innerHTML = 'Gợi ý: ' + GOI_Y[vai].map(s=>'<code onclick="fill(this)">'+esc(s)+'</code>').join('');
}
function fill(el){ $('#i').value = el.textContent; $('#i').focus(); }
function reset(){ conv='ui-'+Date.now(); seq=0; history.length=0; $('#log').innerHTML=''; $('#i').focus(); }
async function donDon(){
  const r = await (await fetch('/cleanup',{method:'POST'})).json();
  alert('Đã xoá ' + r.soLuong + ' đơn nháp thử nghiệm.');
}

async function gui(e){
  e.preventDefault();
  const v = $('#i').value.trim(); if(!v) return false;
  $('#i').value=''; $('#b').disabled=true;
  const laKh = vai==='khach';
  const nhan = laKh ? 'Khách' : 'Bạn';

  const box = document.createElement('div');
  box.className='turn';
  box.innerHTML = '<div class="you'+(laKh?' kh':'')+'" data-vai="'+nhan+'">'+esc(v)+'</div>'
    + '<div class="stat">đang chạy…</div>';
  $('#log').appendChild(box); $('#log').scrollTop = $('#log').scrollHeight;

  try{
    const r = await (await fetch('/chat',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({vai, noiDung:v, conversationId:conv, seq:seq++, history})})).json();

    let h = '<div class="you'+(laKh?' kh':'')+'" data-vai="'+nhan+'">'+esc(v)+'</div>';
    if(r.log?.length){
      h += '<div class="tools">' + r.log.map(l =>
        '<div class="tool'+(l.thanhCong?'':' err')+'">'+
        '<span class="nm">'+esc(l.toolName)+'</span> '+
        '<span class="in">'+esc(JSON.stringify(l.input))+'</span> '+
        '<span class="in">· '+l.durationMs+'ms</span>'+
        '<div class="out">'+esc(l.output)+'</div></div>').join('') + '</div>';
    }
    (r.chuyenSale||[]).forEach(c => { h += '<div class="warn">→ Chuyển sale: '+esc(c)+'</div>'; });

    if(r.trangThai==='khong_phai_lenh')
      h += '<div class="warn">Không nhận diện là lệnh — cần có tag <b>@bot</b>.</div>';
    else if(r.trangThai==='chua_hoan_tat')
      h += '<div class="warn">CHƯA HOÀN TẤT — '+esc(r.lyDo)+'</div>';
    else {
      h += '<div class="reply'+(laKh?' kh':'')+'">'+esc(r.traLoi)+'</div>';
      // Ghi lịch sử cho CẢ HAI vai. Trước đây chỉ ghi cho khách nên luồng nhân
      // viên mất ngữ cảnh giữa các lượt (bug lên đơn nhiều lượt 2026-07-30).
      history.push({vai:'khach',noiDung:v});
      history.push({vai:'shop',noiDung:r.traLoi});
      // Hóa đơn: mô phỏng đúng thứ Zalo sẽ đính kèm.
      if(r.anhSanPham){
        h += '<div class="hoadon"><img src="'+r.anhSanPham+'" alt="Ảnh sản phẩm"></div>';
      }
      if(r.hoaDon){
        var hd = r.hoaDon;
        h += '<div class="hoadon">';
        if(hd.anhDataUrl) h += '<img src="'+hd.anhDataUrl+'" alt="Hóa đơn '+esc(hd.maDon)+'">';
        else h += '<div class="warn">Không tạo được ảnh: '+esc(hd.loiAnh||'')+'</div>';
        h += '<a href="'+esc(hd.link)+'" target="_blank">Mở đơn '+esc(hd.maDon)+' trong Odoo →</a>';
        h += '</div>';
      }
    }

    const u = r.usage;
    h += '<div class="stat"><span>'+r.giay+'s</span><span>'+(r.log?.length||0)+' tool</span>'+
      (u ? '<span>in '+u.inputTokens+'</span><span>out '+u.outputTokens+'</span>'+
           '<span>cache '+u.cacheReadTokens+'</span>' : '')+'</div>';
    box.innerHTML = h;
  }catch(err){
    box.innerHTML = '<div class="you" data-vai="'+nhan+'">'+esc(v)+'</div>'
      + '<div class="warn">Lỗi: '+esc(err.message)+'</div>';
  }
  $('#b').disabled=false; $('#i').focus(); $('#log').scrollTop = $('#log').scrollHeight;
  return false;
}
setVai('khach');
</script></body></html>`;

const server = createServer(async (req, res) => {
  const json = (code: number, body: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };

  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(HTML);
  }

  if (req.method === 'GET' && req.url === '/info') {
    return json(200, { model: `${LLM_MODEL} (${LLM_KIND})`, db: process.env.ODOO_DB });
  }

  if (req.method === 'POST' && req.url === '/cleanup') {
    let n = 0;
    for (const id of donDaTao) {
      try { await odoo.execute('sale.order', 'unlink', [[id]]); n += 1; } catch { /* bỏ qua */ }
    }
    donDaTao.clear();
    return json(200, { soLuong: n });
  }

  if (req.method === 'POST' && req.url === '/chat') {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    try {
      const b = JSON.parse(Buffer.concat(chunks).toString());
      return json(200, await xuLy({
        vai: b.vai === 'nhanvien' ? 'nhanvien' : 'khach',
        noiDung: String(b.noiDung),
        conversationId: String(b.conversationId),
        seq: Number(b.seq) || 0,
        history: Array.isArray(b.history) ? b.history.slice(-10) : [],
      }));
    } catch (err) {
      return json(500, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  res.writeHead(404).end();
});

odoo
  .authenticate()
  .then(async () => {
    // Bật tri thức TRƯỚC khi nhận request đầu tiên — nếu bật sau, request sớm
    // sẽ thấy timDoanTriThuc = undefined và tool không được đăng ký.
    const triThuc = await chuanBiTriThuc();
    server.listen(PORT, () => {
      console.log(`\n  Sân chơi thử bot:  http://localhost:${PORT}\n`);
      console.log(`  LLM  : ${LLM_MODEL} (${LLM_KIND})`);
      console.log(`  Odoo : ${process.env.ODOO_DB} @ ${process.env.ODOO_URL}`);
      console.log(`  Tri thức: ${triThuc}`);
      console.log(`\n  2 vai: KHÁCH (bot tư vấn) · NHÂN VIÊN (bot lên đơn, cần @bot)`);
      console.log(`  Đơn tạo ra là DRAFT. Bấm "Dọn đơn thử" để xoá.\n`);
    });
  })
  .catch((err) => {
    console.error('Không kết nối được Odoo:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
