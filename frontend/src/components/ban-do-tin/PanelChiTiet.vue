<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  PanelChiTiet — panel phải (≥ 1024) hoặc bottom sheet (< 1024). Sáu dạng: trống (hướng dẫn + chú giải) · khối · liên kết ·
  pha · đích (hàng) · loại. Panel khối: khi nào gửi, ví dụ bong bóng Zalo (nguyên văn vi_du), nguồn câu, ĐÍCH (tick, 🔒 lý do,
  cảnh báo lộ dữ liệu), chế độ tắt/bóng/bật, "nếu bật, 24h qua sẽ gửi N", gửi thử, số 7 ngày, nhận từ / đẩy sang, nhật ký.
-->
<template>
  <aside class="bdt-panel" :class="{ sheet }" aria-label="Chi tiết" data-panel>
    <div v-if="sheet" class="tay-cam" />

    <!-- ── Trống ── -->
    <div v-if="!chon" class="bdt-panel-trong">
      <h3>Bấm vào sơ đồ để bắt đầu</h3>
      <p class="mo-ta">Mỗi khối là một loại tin bot gửi tới một đích. Cột là pha của việc, hàng là nơi tin tới. Chọn một khối để
        thấy tin nào dẫn tới nó và nó dẫn tới đâu.</p>
      <h4 class="bdt-h4" style="margin-top: 18px">Sáu loại liên kết</h4>
      <button
        v-for="k in KIEU_DUONG" :key="k.id" type="button" class="bdt-chu-giai" :data-loai="k.id"
        @click="s.datChon({ kieu: 'loai', id: k.id })"
      ><MauNet :loai="k.id" /><span class="ten">{{ k.ten }}</span><span class="so">{{ demLoai[k.id] }}</span></button>
      <h4 class="bdt-h4" style="margin-top: 16px">Nhãn khối</h4>
      <div class="bdt-nhan-khoi">
        <span><span class="bdt-tag t-ma">Mã</span>mã soạn</span>
        <span><span class="bdt-tag t-model">Model</span>model viết</span>
        <span><span class="bdt-tag t-mau">Mẫu</span>tin khuôn</span>
        <span><span class="bdt-tag t-anh">Ảnh</span>ảnh Odoo</span>
        <span><span class="bdt-tag t-moi">Mới</span>đề xuất</span>
        <span><span class="bdt-tag t-bong">Bóng</span>ghi sổ, chưa gửi</span>
      </div>
      <p class="bdt-nho" style="margin-top: 14px">Mẹo: bấm tên pha hoặc tên đích để xem cả cột, cả hàng. Khối viền cam bên trái là
        <b>bản sao theo luật</b>. Phím Esc để bỏ chọn.</p>
      <div class="bdt-hai-nut" style="margin-top: 14px">
        <button type="button" class="bdt-nut" @click="taiJson"><Download :size="14" />Tải JSON luật</button>
      </div>
      <p v-if="s.anh.value?.mau" class="bdt-canh" style="margin-top: 12px">Đang xem DỮ LIỆU MẪU: cạnh "dẫn tới" viết tay, số đếm giả.
        Bot sẽ đẩy danh mục thật (docs/78 B4).</p>
    </div>

    <!-- ── Khối ── -->
    <template v-else-if="chon.kieu === 'khoi' && khoi">
      <div class="bdt-panel-dau">
        <div class="bdt-duong-dan">
          <button type="button" @click="s.datChon({ kieu: 'pha', id: khoi.pha })">{{ pha(khoi.pha).ma }} · {{ pha(khoi.pha).ten }}</button>
          <span class="ngan">›</span>
          <button type="button" @click="s.datChon({ kieu: 'hang', id: khoi.hang })">{{ mh.hang[khoi.hang].ten }}</button>
        </div>
        <h3>{{ khoi.ten }}</h3>
        <div class="tags">
          <span v-for="t in khoi.tags" :key="t" class="bdt-tag" :class="LOP_TAG[t]">{{ t }}</span>
          <span v-if="khoi.ban_sao" class="bdt-tag t-anh">Bản sao theo luật</span>
          <span v-if="comp" class="bdt-tag t-ma">{{ comp.kieu === 'khoa' ? '🔒 đích cố định' : comp.kieu === 'ban_sao' ? '✎ thêm bản sao' : '✎ đổi đích tự do' }}</span>
        </div>
        <button type="button" class="bdt-dong-x" aria-label="Đóng" @click="s.datChon(null)"><X :size="16" /></button>
        <button type="button" class="bdt-copy" @click="chepLink"><Link :size="13" />{{ daChep ? 'Đã chép link' : 'Copy link' }}</button>
      </div>
      <div class="bdt-panel-than">
        <template v-if="comp">
          <div class="bdt-nho">Ai soạn: <b>{{ comp.ai_soan }}</b> · <span class="bdt-code">{{ comp.id }}</span></div>
          <section><h4 class="bdt-h4">Khi nào gửi</h4><p class="bdt-chu">{{ comp.khi_nao }}</p></section>
          <section>
            <h4 class="bdt-h4">Ví dụ — NV thấy trên Zalo</h4>
            <div class="bdt-zalo-dau"><span class="av"><Bot :size="12" /></span>Bot LEDNELIA{{ comp.de_xuat ? ' · đề xuất, chưa có trong mã' : '' }}</div>
            <div class="bdt-zalo" data-vi-du>{{ comp.vi_du }}</div>
            <details v-if="comp.ghi_chu" class="bdt-bien-the"><summary>Biến thể &amp; ghi chú</summary><p class="bdt-nho">{{ comp.ghi_chu }}</p></details>
          </section>
          <section><h4 class="bdt-h4">Nguồn câu</h4><span class="bdt-code">{{ comp.nguon_cau }}</span></section>
          <p v-if="comp.goi_y" class="bdt-nho">💡 {{ comp.goi_y }}</p>

          <section data-dich>
            <h4 class="bdt-h4">Đích <span class="dem">{{ dichHienTai.length }}</span></h4>
            <div v-if="comp.kieu === 'khoa'" class="bdt-khoa-ly-do"><Lock :size="13" style="flex: none; margin-top: 2px" />Đích cố định: {{ comp.ly_do_khoa ?? 'thuộc lượt chat' }}</div>
            <label v-for="d in dsDich" :key="d" class="bdt-dich" :class="{ khoa: !!dichKhoa(comp, d) }" :data-dich-dong="d">
              <input
                type="checkbox" :checked="dichHienTai.includes(d)"
                :disabled="!!dichKhoa(comp, d) || !!kiemDich(comp, d)?.chan || s.dangLuu.value"
                @change="doiDich(d, ($event.target as HTMLInputElement).checked)"
              >
              <span style="min-width: 0">
                <span class="ten">{{ mh.hang[d].ten }}<span v-if="dichKhoa(comp, d)">🔒</span></span>
                <span v-if="dichKhoa(comp, d) && comp.kieu !== 'khoa'" class="vi-sao">{{ dichKhoa(comp, d) }}</span>
                <span v-if="kiemDich(comp, d)?.chan" class="bdt-chan" style="display: block">{{ kiemDich(comp, d)!.chan }}</span>
                <span v-else-if="kiemDich(comp, d)?.canh && dichHienTai.includes(d)" class="bdt-canh" style="display: block">{{ kiemDich(comp, d)!.canh }}</span>
              </span>
            </label>
            <p v-if="comp.nhay_cam.length" class="bdt-canh" data-lo>⚠️ Tin có <b>{{ comp.nhay_cam.join(', ') }}</b> — mỗi đích nhận bản che theo quyền
              của chính đích (Admin/Kế toán thấy đủ; nhóm khách không bao giờ nhận).</p>
            <p v-if="s.loiLuu.value" class="bdt-chan" role="alert">{{ s.loiLuu.value }}</p>
          </section>

          <section>
            <h4 class="bdt-h4">Chế độ</h4>
            <div class="bdt-che-do" role="group" aria-label="Chế độ">
              <button
                v-for="c in CHE_DO" :key="c.id" type="button" :class="c.id" :aria-pressed="cheDo === c.id"
                :disabled="comp.kieu === 'khoa' || s.dangLuu.value" @click="doiCheDo(c.id)"
              >{{ c.ten }}</button>
            </div>
            <p v-if="comp.kieu === 'ban_sao'" class="bdt-nho" style="margin-top: 6px">Chế độ áp cho BẢN SAO; nơi gốc luôn gửi.</p>
            <p v-if="cheDo === 'bong'" class="bdt-nho" data-neu-bat style="margin-top: 6px">Nếu bật, 24 giờ qua sẽ gửi <b>{{ neuBat }}</b> tin.</p>
            <div class="bdt-hai-nut" style="margin-top: 10px">
              <button type="button" class="bdt-nut" :disabled="!s.client.coGuiThu" :title="s.client.coGuiThu ? '' : 'Cần backend — chưa nối'"><Send :size="13" />Gửi thử</button>
              <button v-if="luat" type="button" class="bdt-nut" :disabled="s.dangLuu.value" @click="s.hoanLai(comp.id)"><RotateCcw :size="13" />Hoàn lại như mã</button>
            </div>
          </section>

          <section v-if="demKhoi">
            <h4 class="bdt-h4">7 ngày qua</h4>
            <div class="bdt-so"><span><b>{{ demKhoi.so }}</b> đã gửi</span><span><b>{{ demKhoi.chan }}</b> bị chặn</span><span><b>{{ demKhoi.bong }}</b> chạy bóng</span></div>
          </section>
        </template>
        <template v-else-if="nut">
          <p class="bdt-chu">{{ nut.mo_ta }}</p>
          <p class="bdt-khoa-ly-do"><Lock :size="13" style="flex: none; margin-top: 2px" />{{ khoi.loai_nut === 'crm' ? 'Tin CRM tự gửi — chỉ xem ở đây.' : 'Nguồn sự kiện — không phải tin, không có đích.' }}</p>
        </template>

        <section>
          <h4 class="bdt-h4">Nhận từ <span class="dem">{{ vao.length }}</span></h4>
          <DongLienKet v-for="l in vao" :key="l.id" :l="l" huong="vao" />
          <p v-if="!vao.length" class="bdt-nho">Không có — tin này bắt đầu từ tin NV gõ.</p>
        </section>
        <section>
          <h4 class="bdt-h4">Đẩy sang <span class="dem">{{ ra.length }}</span></h4>
          <DongLienKet v-for="l in ra" :key="l.id" :l="l" huong="ra" />
          <p v-if="!ra.length" class="bdt-nho">Không có.</p>
        </section>
        <section v-if="comp">
          <h4 class="bdt-h4">Nhật ký thay đổi</h4>
          <ul class="bdt-nhat-ky">
            <li v-for="(n, i) in nhatKy" :key="i"><time>{{ gio(n.luc) }}</time>{{ n.nguoi }} — {{ n.noi_dung }}</li>
            <li v-if="!nhatKy.length" class="bdt-nho">Chưa đổi gì — đang chạy như mã.</li>
          </ul>
          <div class="bdt-hai-nut" style="margin-top: 10px"><button type="button" class="bdt-nut" @click="taiJson"><Download :size="13" />Tải JSON luật</button></div>
        </section>
      </div>
    </template>

    <!-- ── Liên kết ── -->
    <template v-else-if="chon.kieu === 'lien_ket' && lk">
      <div class="bdt-panel-dau">
        <div class="bdt-duong-dan"><span>Liên kết {{ lk.so }}</span><span class="ngan">›</span>
          <button type="button" @click="s.datChon({ kieu: 'loai', id: lk.loai })">{{ KIEU_DUONG_THEO_ID[lk.loai].ten }}</button></div>
        <h3>{{ tenDay(lk.tu) }} → {{ tenDay(lk.den) }}</h3>
        <button type="button" class="bdt-dong-x" aria-label="Đóng" @click="s.datChon(null)"><X :size="16" /></button>
        <button type="button" class="bdt-copy" @click="chepLink"><Link :size="13" />{{ daChep ? 'Đã chép link' : 'Copy link' }}</button>
      </div>
      <div class="bdt-panel-than">
        <section><h4 class="bdt-h4">Điểm đi</h4><DongLienKet :l="lk" huong="vao" /></section>
        <section><h4 class="bdt-h4">Điểm đến</h4><DongLienKet :l="lk" huong="ra" /></section>
        <section><h4 class="bdt-h4">Vì sao nối</h4><p class="bdt-chu">{{ lk.vi_sao || KIEU_DUONG_THEO_ID[lk.loai].mo_ta }}</p></section>
        <section v-if="lk.dem"><h4 class="bdt-h4">7 ngày qua</h4>
          <div class="bdt-so"><span><b>{{ lk.dem.so }}</b> lần</span><span><b>{{ lk.dem.chan }}</b> bị chặn</span><span><b>{{ lk.dem.bong }}</b> bóng</span></div></section>
        <div class="bdt-hai-nut">
          <button type="button" class="bdt-nut" :disabled="lk.so <= 1" @click="nhayLk(-1)">‹ Liên kết trước</button>
          <button type="button" class="bdt-nut" :disabled="lk.so >= mh.lienKet.length" @click="nhayLk(1)">Liên kết sau ›</button>
        </div>
      </div>
    </template>

    <!-- ── Pha / đích / loại ── -->
    <template v-else>
      <div class="bdt-panel-dau">
        <div class="bdt-duong-dan"><span>{{ chon.kieu === 'pha' ? 'Pha' : chon.kieu === 'hang' ? 'Đích' : 'Loại liên kết' }}</span></div>
        <h3>{{ tieuDeTap }}</h3>
        <button type="button" class="bdt-dong-x" aria-label="Đóng" @click="s.datChon(null)"><X :size="16" /></button>
        <button type="button" class="bdt-copy" @click="chepLink"><Link :size="13" />{{ daChep ? 'Đã chép link' : 'Copy link' }}</button>
      </div>
      <div class="bdt-panel-than">
        <p v-if="chon.kieu !== 'loai'" class="bdt-chu"><b>{{ tapKhoi.length }}</b> khối · <b>{{ soVao }}</b> liên kết vào · <b>{{ soRa }}</b> liên kết ra</p>
        <p v-if="chon.kieu === 'pha'" class="bdt-trich">“{{ pha(chon.id).cau_hoi }}”</p>
        <section v-if="chon.kieu !== 'loai'">
          <h4 class="bdt-h4">Các khối</h4>
          <button v-for="k in tapKhoi" :key="k.id" type="button" class="bdt-lk" @click="s.datChon({ kieu: 'khoi', id: k.id })">
            <span class="o-ico" style="width: 20px; height: 20px; display: grid; place-items: center; color: var(--bdt-brand)"><IconBdt :ten="mh.hang[k.hang].icon" :size="13" /></span>
            <span><span class="d1">{{ k.ten }} <small>{{ chon.kieu === 'pha' ? mh.hang[k.hang].ten : pha(k.pha).ma }}</small></span></span>
          </button>
        </section>
        <section v-else>
          <h4 class="bdt-h4">{{ lkLoai.length }} liên kết</h4>
          <button v-for="l in lkLoai" :key="l.id" type="button" class="bdt-lk" @click="s.datChon({ kieu: 'lien_ket', id: l.id })">
            <SoTron :so="l.so" :loai="l.loai" />
            <span><span class="d1">{{ tenDay(l.tu) }} → {{ tenDay(l.den) }}</span><span class="d2">{{ l.vi_sao }}</span></span>
          </button>
        </section>
      </div>
    </template>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Bot, Download, Link, Lock, RotateCcw, Send, X } from 'lucide-vue-next';
import DongLienKet from './DongLienKet.vue';
import IconBdt from './IconBdt.vue';
import MauNet from './MauNet.vue';
import SoTron from './SoTron.vue';
import { DICH_CO_THE_THEM, KIEU_DUONG, KIEU_DUONG_THEO_ID } from '@/views/settings/ban-do-tin/cau-hinh';
import { dichKhoa, kiemDich } from '@/views/settings/ban-do-tin/luat';
import { demTheoLoai, dichHieuLuc } from '@/views/settings/ban-do-tin/mo-hinh';
import { dungBanDoTin } from '@/views/settings/ban-do-tin/use-ban-do-tin';
import type { CheDo, MaDich, MaPha, TagKhoi } from '@/views/settings/ban-do-tin/kieu';

defineProps<{ sheet?: boolean }>();
const s = dungBanDoTin();
const mh = computed(() => s.mh.value!);
const chon = computed(() => s.chon.value);
const LOP_TAG: Record<TagKhoi, string> = { Mã: 't-ma', Model: 't-model', Mẫu: 't-mau', Ảnh: 't-anh', Mới: 't-moi', Bóng: 't-bong', Nguồn: 't-nguon', CRM: 't-crm' };
const CHE_DO: { id: CheDo; ten: string }[] = [{ id: 'tat', ten: 'Tắt' }, { id: 'bong', ten: 'Chạy bóng' }, { id: 'bat', ten: 'Bật' }];
/** tên khối + đích khi là bản sao (hai đầu cùng một loại tin) */
const tenDay = (id: string) => { const k = mh.value.khoiTheoId[id]; return k.ban_sao ? `${k.ten} (${mh.value.hang[k.hang].ten})` : k.ten; };
const pha = (id: string) => mh.value.pha.find((p) => p.id === (id as MaPha))!;
const demLoai = computed(() => demTheoLoai(mh.value.lienKet));

const khoi = computed(() => (chon.value?.kieu === 'khoi' ? mh.value.khoiTheoId[chon.value.id] : undefined));
const comp = computed(() => (khoi.value?.loai_nut === 'composer' ? mh.value.composer[khoi.value.nguon_id] : undefined));
const nut = computed(() => (khoi.value && khoi.value.loai_nut !== 'composer' ? mh.value.nutPhu[khoi.value.nguon_id] : undefined));
const luat = computed(() => (comp.value ? s.anh.value?.luat.find((l) => l.loai === comp.value!.id) : undefined));
const hieuLuc = computed(() => (comp.value ? dichHieuLuc(comp.value, luat.value) : null));
const dichHienTai = computed<MaDich[]>(() => (comp.value ? (luat.value?.dich ?? comp.value.dich_goc) : []));
const cheDo = computed<CheDo>(() => hieuLuc.value?.cheDo ?? 'bat');
const dsDich = computed<MaDich[]>(() => {
  const c = comp.value;
  if (!c) return [];
  if (c.kieu === 'khoa') return [...c.dich_goc];
  return [...new Set<MaDich>([...c.dich_goc, ...dichHienTai.value, ...DICH_CO_THE_THEM])];
});
const vao = computed(() => (khoi.value ? mh.value.vao[khoi.value.id] : []));
const ra = computed(() => (khoi.value ? mh.value.ra[khoi.value.id] : []));
const demKhoi = computed(() => (khoi.value ? mh.value.demKhoi[khoi.value.id] : undefined));
const neuBat = computed(() => mh.value.khoi.filter((k) => k.nguon_id === comp.value?.id)
  .reduce((t, k) => t + (mh.value.demKhoi[k.id]?.bong_24h ?? 0), 0));
const nhatKy = computed(() => (s.anh.value?.nhat_ky ?? []).filter((n) => comp.value && n.noi_dung.startsWith(`${comp.value.ten}:`)));

function doiDich(d: MaDich, co: boolean) {
  const c = comp.value!;
  const moi = co ? [...dichHienTai.value, d] : dichHienTai.value.filter((x) => x !== d);
  const thuTu = dsDich.value;
  s.luuLuat(c.id, thuTu.filter((x) => moi.includes(x)), cheDo.value);
}
function doiCheDo(c: CheDo) { if (comp.value && c !== cheDo.value) s.luuLuat(comp.value.id, dichHienTai.value, c); }

const lk = computed(() => (chon.value?.kieu === 'lien_ket' ? mh.value.lienKetTheoId[chon.value.id] : undefined));
function nhayLk(b: number) { const l = mh.value.lienKet[lk.value!.so - 1 + b]; if (l) s.datChon({ kieu: 'lien_ket', id: l.id }); }

const tapKhoi = computed(() => {
  const c = chon.value;
  if (!c) return [];
  if (c.kieu === 'pha') return mh.value.khoi.filter((k) => k.pha === c.id);
  if (c.kieu === 'hang') return mh.value.khoi.filter((k) => k.hang === c.id);
  return [];
});
const soVao = computed(() => { const t = new Set(tapKhoi.value.map((k) => k.id)); return tapKhoi.value.reduce((n, k) => n + mh.value.vao[k.id].filter((l) => !t.has(l.tu)).length, 0); });
const soRa = computed(() => { const t = new Set(tapKhoi.value.map((k) => k.id)); return tapKhoi.value.reduce((n, k) => n + mh.value.ra[k.id].filter((l) => !t.has(l.den)).length, 0); });
const lkLoai = computed(() => (chon.value?.kieu === 'loai' ? mh.value.lienKet.filter((l) => l.loai === chon.value!.id) : []));
const tieuDeTap = computed(() => {
  const c = chon.value!;
  if (c.kieu === 'pha') return `${pha(c.id).ma} · ${pha(c.id).ten}`;
  if (c.kieu === 'hang') return mh.value.hang[c.id as MaDich]?.ten ?? c.id;
  if (c.kieu === 'loai') return KIEU_DUONG_THEO_ID[c.id].ten;
  return '';
});

const daChep = ref(false);
async function chepLink() {
  try { await navigator.clipboard.writeText(location.href); daChep.value = true; setTimeout(() => (daChep.value = false), 1500); } catch { /* trình duyệt chặn — bỏ qua */ }
}
const gio = (iso: string) => { const d = new Date(iso); return isNaN(+d) ? iso : d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }); };
function taiJson() {
  const a = s.anh.value;
  if (!a) return;
  const b = new Blob([JSON.stringify({ ghi_chu: 'Bản đồ tin — luật đích hiện hành', phien_ban: a.phien_ban, luat: a.luat.map(({ loai, dich, che_do }) => ({ loai, dich, che_do })) }, null, 2)], { type: 'application/json' });
  const u = URL.createObjectURL(b);
  const el = document.createElement('a');
  el.href = u; el.download = 'luat-ban-do-tin.json'; el.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
</script>
