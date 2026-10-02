<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  PanelChiTiet — panel phải (≥ 1024) hoặc bottom sheet (< 1024). Sáu dạng: trống (hướng dẫn + chú giải) · khối · liên kết ·
  pha · đích (hàng) · loại. Panel khối composer: khi nào gửi, ví dụ (vi_du bot khai), nguồn câu, ĐÍCH (nơi gốc 🔒 + tick bản
  sao ⇒ POST/PUT /bot-quyen/luat-thong-bao), chế độ tắt/bóng/bật, "nếu bật, 24h qua sẽ gửi N" (số bóng của luật), cảnh báo
  CRM (canhBao), số 7 ngày, nhận từ / đẩy sang, và link sang Quyền bot › Nhật ký. Khối CRM tự động: chỉ xem.
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
        <span><span class="bdt-tag t-soan s-ma">Mã</span><span class="bdt-tag t-soan s-model">Model</span><span class="bdt-tag t-soan s-mau">Mẫu</span><span class="bdt-tag t-soan s-anh">Ảnh</span>ai soạn tin</span>
        <span><span class="bdt-tag t-nhay">Nhạy cảm</span>giá/SĐT/tiền/lãi</span>
        <span><span class="bdt-tag t-moi">Mới</span>đề xuất</span>
        <span><span class="bdt-tag t-bong">Bóng</span>ghi sổ, chưa gửi</span>
        <span><span class="bdt-tag t-crm">CRM</span>CRM tự gửi</span>
        <span><span class="bdt-tag t-tat">Tắt</span>đang không gửi</span>
      </div>
      <p class="bdt-nho" style="margin-top: 14px">Mẹo: bấm tên pha hoặc tên đích để xem cả cột, cả hàng. Khối viền cam bên trái là
        <b>bản sao theo luật</b>. Phím Esc để bỏ chọn.</p>
      <div class="bdt-hai-nut" style="margin-top: 14px">
        <button type="button" class="bdt-nut" @click="taiJson"><Download :size="14" />Tải JSON luật</button>
      </div>
      <p v-if="s.anh.value?.mau" class="bdt-canh" style="margin-top: 12px">Đang xem DỮ LIỆU MẪU: cạnh "dẫn tới" viết tay, số đếm giả.</p>
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
          <span v-if="comp?.ai_soan" class="bdt-tag" :class="LOP_SOAN[comp.ai_soan]" :title="MO_TA_SOAN[comp.ai_soan]" data-soan>Soạn: {{ TEN_SOAN[comp.ai_soan] }}</span>
          <span v-for="t in khoi.tags" :key="t" class="bdt-tag" :class="LOP_TAG[t]">{{ t }}</span>
          <span v-if="khoi.ban_sao" class="bdt-tag t-ban-sao">Bản sao theo luật</span>
          <span v-if="comp" class="bdt-tag t-khoa">{{ comp.kieu === 'khoa' ? '🔒 đích cố định' : comp.kieu === 'ban_sao' ? '✎ thêm bản sao' : '✎ tin thông báo' }}</span>
        </div>
        <button type="button" class="bdt-dong-x" aria-label="Đóng" @click="s.datChon(null)"><X :size="16" /></button>
        <button type="button" class="bdt-copy" @click="chepLink"><Link :size="13" />{{ daChep ? 'Đã chép link' : 'Copy link' }}</button>
      </div>
      <div class="bdt-panel-than">
        <template v-if="comp">
          <div class="bdt-nho"><span class="bdt-code">{{ comp.id }}</span><template v-if="comp.pha_la"> · pha bot khai: <b>{{ comp.pha_la }}</b> (chưa có cột — vẽ ở P9)</template></div>
          <section v-if="comp.khi_nao"><h4 class="bdt-h4">Khi nào gửi</h4><p class="bdt-chu">{{ comp.khi_nao }}</p></section>
          <section v-if="comp.vi_du">
            <h4 class="bdt-h4">Ví dụ — NV thấy trên Zalo</h4>
            <div class="bdt-zalo-dau"><span class="av"><Bot :size="12" /></span>Bot LEDNELIA{{ comp.de_xuat ? ' · đề xuất, chưa có trong mã' : '' }}</div>
            <div class="bdt-zalo" data-vi-du>{{ comp.vi_du }}</div>
            <details v-if="comp.ghi_chu" class="bdt-bien-the"><summary>Biến thể &amp; ghi chú</summary><p class="bdt-nho">{{ comp.ghi_chu }}</p></details>
          </section>
          <section v-if="comp.nguon_cau"><h4 class="bdt-h4">Nguồn câu</h4><span class="bdt-code">{{ comp.nguon_cau }}</span></section>
          <p v-if="comp.goi_y" class="bdt-goi-y" data-goi-y>💡 {{ comp.goi_y }}</p>

          <section data-dich>
            <h4 class="bdt-h4">Đích <span class="dem">{{ dichDangGui.length }}</span></h4>
            <div v-if="comp.kieu === 'khoa'" class="bdt-khoa-ly-do" data-ly-do-khoa><Lock :size="13" style="flex: none; margin-top: 2px" />{{ dichKhoa(comp, comp.dich_goc[0]) }}</div>
            <p v-if="comp.dich_goc_la?.length" class="bdt-canh">Bot khai đích gốc chưa có hàng trên bản đồ: <b>{{ comp.dich_goc_la.join(', ') }}</b>.</p>
            <template v-for="d in dsDich" :key="d">
              <label class="bdt-dich" :class="{ khoa: !!dichKhoa(comp, d) }" :data-dich-dong="d">
                <input
                  type="checkbox" :checked="dichDangGui.includes(d)"
                  :disabled="!!dichKhoa(comp, d) || !!kiemDich(comp, d)?.chan || s.dangLuu.value || (d === 'nv' && !dichDangGui.includes('nv'))"
                  @change="doiDich(d, $event.target as HTMLInputElement)"
                >
                <span style="min-width: 0">
                  <span class="ten">{{ mh.hang[d].ten }}<span v-if="dichKhoa(comp, d)">🔒</span><span v-if="trangThaiHang(d)" class="bdt-nho"> · {{ trangThaiHang(d) }}</span></span>
                  <span v-if="dichKhoa(comp, d) && comp.kieu !== 'khoa'" class="vi-sao">{{ dichKhoa(comp, d) }}</span>
                  <span v-if="kiemDich(comp, d)?.chan" class="bdt-chan" style="display: block">{{ kiemDich(comp, d)!.chan }}</span>
                  <span v-else-if="kiemDich(comp, d)?.canh && dichDangGui.includes(d)" class="bdt-canh" style="display: block">{{ kiemDich(comp, d)!.canh }}</span>
                </span>
              </label>
              <!-- Một NV chỉ định: mỗi đích nv mang zalo_uid — thêm/bỏ từng người -->
              <div v-if="d === 'nv' && comp.kieu !== 'khoa'" class="bdt-nv-dich" data-nv-dich>
                <span v-for="n in nvDangGui" :key="n" class="bdt-chip-nv">{{ tenNv(n) }}
                  <button type="button" :aria-label="`Bỏ ${tenNv(n)}`" :disabled="s.dangLuu.value" @click="boNv(n)"><X :size="11" /></button>
                </span>
                <select class="bdt-chon-nv" :disabled="s.dangLuu.value" aria-label="Thêm một NV chỉ định" data-them-nv @focus="napNv" @change="themNv(($event.target as HTMLSelectElement))">
                  <option value="">+ Thêm NV…</option>
                  <option v-for="n in nvChonDuoc" :key="n.zaloUid" :value="n.zaloUid">{{ n.tenGoi }}</option>
                </select>
                <span v-if="loiNv" class="bdt-chan">{{ loiNv }}</span>
              </div>
            </template>
            <p v-if="comp.nhay_cam.length" class="bdt-canh" data-lo>⚠️ Tin có <b>{{ tenNhayCam(comp.nhay_cam) }}</b> — mỗi đích nhận bản che theo quyền
              của chính đích (Admin/Kế toán thấy đủ; nhóm khách không bao giờ nhận).</p>
            <p v-if="loiCuaComp" class="bdt-chan" role="alert" data-loi-luu>{{ loiCuaComp }}</p>
            <p v-if="s.tinLuu.value" class="bdt-nho" data-tin-luu>{{ s.tinLuu.value }}</p>
            <div v-for="(c, i) in canhBaoCuaComp" :key="i" class="bdt-canh" data-canh-bao>⚠️ CRM sẽ bỏ khi phát cho bot: {{ c }}</div>
          </section>

          <section v-if="comp.kieu !== 'khoa'">
            <h4 class="bdt-h4">Chế độ bản sao</h4>
            <div class="bdt-che-do" role="group" aria-label="Chế độ">
              <button
                v-for="c in CHE_DO" :key="c.id" type="button" :class="c.id" :aria-pressed="!!luat && cheDo === c.id"
                :disabled="s.dangLuu.value" @click="doiCheDo(c.id)"
              >{{ c.ten }}</button>
            </div>
            <p v-if="!luat" class="bdt-nho" style="margin-top: 6px" data-chua-luat>Chưa có luật — tin chạy đúng như mã. Tick một đích để tạo luật
              (mặc định <b>chạy bóng</b>: bot ghi sổ, chưa gửi).</p>
            <p v-else class="bdt-nho" style="margin-top: 6px">Áp cho BẢN SAO; nơi gốc luôn gửi như mã.</p>
            <p v-if="luat && cheDo === 'bong'" class="bdt-nho" data-neu-bat style="margin-top: 6px">
              <template v-if="bong24h.co">Nếu bật, 24 giờ qua sẽ gửi <b>{{ bong24h.so }}</b> tin.</template>
              <template v-else>Chưa có số chạy bóng 24 giờ — bot chưa đếm luật này (số tới sau lần đồng bộ kế tiếp).</template>
            </p>
            <div class="bdt-hai-nut" style="margin-top: 10px">
              <button type="button" class="bdt-nut" disabled title="Chưa có — CRM chưa mở API gửi thử"><Send :size="13" />Gửi thử</button>
              <button v-if="luat" type="button" class="bdt-nut" :disabled="s.dangLuu.value" data-hoan-lai @click="s.hoanLai(comp.id)"><RotateCcw :size="13" />Hoàn lại như mã</button>
            </div>
          </section>

          <section v-if="demKhoi" data-so-khoi>
            <template v-for="cs in CUA_SO" :key="cs.id">
              <h4 class="bdt-h4">{{ cs.ten }}{{ khoi.ban_sao ? ' — bản sao này' : ' — nơi gốc' }}</h4>
              <div class="bdt-so" :data-cua-so="cs.id">
                <span><b>{{ demKhoi[cs.id].da_gui }}</b> đã gửi</span><span><b>{{ demKhoi[cs.id].chan_tam_im }}</b> bị chặn</span>
                <span><b>{{ demKhoi[cs.id].bong }}</b> chạy bóng</span><span v-if="demKhoi[cs.id].loi"><b>{{ demKhoi[cs.id].loi }}</b> lỗi</span>
                <span v-if="demKhoi[cs.id].bo"><b>{{ demKhoi[cs.id].bo }}</b> bỏ (rỗng)</span>
              </div>
            </template>
          </section>
        </template>

        <!-- CRM tự động -->
        <template v-else-if="nut?.crm">
          <p class="bdt-chu">{{ nut.crm.khi_nao }}</p>
          <p class="bdt-khoa-ly-do" data-crm-trang-thai>
            <Lock :size="13" style="flex: none; margin-top: 2px" />
            <span>CRM tự gửi — chỉ xem ở đây. <b>{{ nut.crm.bat ? 'Đang bật.' : 'Đang tắt' }}</b><template v-if="!nut.crm.bat && nut.crm.ly_do_tat">: {{ nut.crm.ly_do_tat }}.</template></span>
          </p>
          <section>
            <h4 class="bdt-h4">Gửi tới <span class="dem">{{ nut.crm.dich.length }}</span></h4>
            <ul class="bdt-crm-dich">
              <li v-for="(d, i) in nut.crm.dich" :key="i" :class="{ tat: !d.bat }">{{ d.ten }}<span class="bdt-nho"> · {{ TEN_LOAI_DICH_CRM[d.loai] }}{{ d.bat ? '' : ' · tắt' }}</span></li>
              <li v-if="!nut.crm.dich.length" class="bdt-nho">Chưa có nơi nhận.</li>
            </ul>
          </section>
          <p v-if="nut.crm.ghi_chu" class="bdt-nho">{{ nut.crm.ghi_chu }}</p>
          <section><h4 class="bdt-h4">Mã gửi</h4><span class="bdt-code">{{ nut.crm.nguon_ma }}</span></section>
          <a v-if="nut.crm.chinh_o" :href="nut.crm.chinh_o" class="bdt-nut" style="align-self: flex-start" @click="diToi($event, nut.crm.chinh_o)">Chỉnh ở trang cài đặt ›</a>
        </template>
        <template v-else-if="nut">
          <p class="bdt-chu">{{ nut.mo_ta }}</p>
          <p class="bdt-khoa-ly-do"><Lock :size="13" style="flex: none; margin-top: 2px" />Nguồn sự kiện — không phải tin, không có đích.</p>
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
          <h4 class="bdt-h4">Luật &amp; nhật ký</h4>
          <p v-if="luat" class="bdt-nho" data-luat-meta>Luật CRM phiên bản <b>{{ luat.phien_ban }}</b>{{ luat.sua_luc ? ` · sửa ${gio(luat.sua_luc)}` : '' }}.</p>
          <p v-else class="bdt-nho">Chưa có luật — đang chạy như mã.</p>
          <div class="bdt-hai-nut" style="margin-top: 10px">
            <a :href="LINK_NHAT_KY" class="bdt-nut" data-nhat-ky @click="diToi($event, LINK_NHAT_KY)">Nhật ký thay đổi (Quyền bot) ›</a>
            <button type="button" class="bdt-nut" @click="taiJson"><Download :size="13" />Tải JSON luật</button>
          </div>
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
        <section v-if="lk.dem"><h4 class="bdt-h4">7 ngày qua (qua luật)</h4>
          <div class="bdt-so"><span><b>{{ lk.dem.d7.da_gui }}</b> đã gửi</span><span><b>{{ lk.dem.d7.chan_tam_im }}</b> bị chặn</span><span><b>{{ lk.dem.d7.bong }}</b> bóng</span></div></section>
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
import { computed, getCurrentInstance, ref, watch } from 'vue';
import { Bot, Download, Link, Lock, RotateCcw, Send, X } from 'lucide-vue-next';
import DongLienKet from './DongLienKet.vue';
import IconBdt from './IconBdt.vue';
import MauNet from './MauNet.vue';
import SoTron from './SoTron.vue';
import type { NvDich } from '@/api/ban-do-tin';
import { KIEU_DUONG, KIEU_DUONG_THEO_ID, LOP_SOAN, LOP_TAG, MO_TA_SOAN, TEN_SOAN, tenNhayCam } from '@/views/settings/ban-do-tin/cau-hinh';
import { bong24hCuaLuat } from '@/views/settings/ban-do-tin/chuyen-doi';
import { dichKhoa, dsDichPanel, kiemDich } from '@/views/settings/ban-do-tin/luat';
import { demTheoLoai, dichHieuLuc } from '@/views/settings/ban-do-tin/mo-hinh';
import { dungBanDoTin } from '@/views/settings/ban-do-tin/use-ban-do-tin';
import type { CheDo, MaDich, MaPha } from '@/views/settings/ban-do-tin/kieu';
import type { MucCrmApi } from '@/views/settings/ban-do-tin/hop-dong';

defineProps<{ sheet?: boolean }>();
const s = dungBanDoTin();
const mh = computed(() => s.mh.value!);
const chon = computed(() => s.chon.value);
const CUA_SO: { id: 'h24' | 'd7'; ten: string }[] = [{ id: 'h24', ten: '24 giờ qua' }, { id: 'd7', ten: '7 ngày qua' }];
const CHE_DO: { id: CheDo; ten: string }[] = [{ id: 'tat', ten: 'Tắt' }, { id: 'bong', ten: 'Chạy bóng' }, { id: 'bat', ten: 'Bật' }];
const TEN_LOAI_DICH_CRM: Record<MucCrmApi['dich'][number]['loai'], string> = { nhom: 'nhóm Zalo', ca_nhan: 'tin riêng', ung_dung: 'trong app', bot: 'bot đọc' };
/** Tab Nhật ký của trang Quyền bot — mọi thay đổi luật/ảnh chụp ghi ở bot_quyen_nhat_ky (luat_thong_bao, ban_do_tin). */
const LINK_NHAT_KY = '/settings/bot-quyen?tab=nhat-ky';
/** tên khối + đích khi là bản sao (hai đầu cùng một loại tin) */
const tenDay = (id: string) => { const k = mh.value.khoiTheoId[id]; return k.ban_sao ? `${k.ten} (${mh.value.hang[k.hang].ten})` : k.ten; };
const pha = (id: string) => mh.value.pha.find((p) => p.id === (id as MaPha))!;
const demLoai = computed(() => demTheoLoai(mh.value.lienKet));

const khoi = computed(() => (chon.value?.kieu === 'khoi' ? mh.value.khoiTheoId[chon.value.id] : undefined));
const comp = computed(() => (khoi.value?.loai_nut === 'composer' ? mh.value.composer[khoi.value.nguon_id] : undefined));
const nut = computed(() => (khoi.value && khoi.value.loai_nut !== 'composer' ? mh.value.nutPhu[khoi.value.nguon_id] : undefined));
const luat = computed(() => (comp.value ? s.luatCua(comp.value.id) : undefined));
const cheDo = computed<CheDo>(() => luat.value?.che_do ?? 'bat');
/** hàng bản sao luật đang khai (kể cả khi luật `tat`) */
const banSaoLuat = computed<MaDich[]>(() => (comp.value && luat.value ? luat.value.dich.filter((d) => !comp.value!.dich_goc.includes(d)) : []));
/** hàng đang tick = nơi gốc + bản sao của luật */
const dichDangGui = computed<MaDich[]>(() => (comp.value ? [...comp.value.dich_goc, ...banSaoLuat.value] : []));
const dsDich = computed<MaDich[]>(() => (comp.value ? dsDichPanel(comp.value, banSaoLuat.value) : []));
const vao = computed(() => (khoi.value ? mh.value.vao[khoi.value.id] : []));
const ra = computed(() => (khoi.value ? mh.value.ra[khoi.value.id] : []));
const demKhoi = computed(() => (khoi.value ? mh.value.demKhoi[khoi.value.id] : undefined));
const bong24h = computed(() => (luat.value ? bong24hCuaLuat(s.anh.value?.dem_tho ?? [], luat.value) : { co: false, so: 0 }));
const loiCuaComp = computed(() => (s.loiLuu.value && s.loiLuu.value.loai === comp.value?.id ? s.loiLuu.value.chu : null));
/** canhBao của CRM cho loại tin này — dạng `<loai>: …` (bot-thong-bao-luat.ts ghepLuatCongKhai) */
const canhBaoCuaComp = computed(() => {
  const c = comp.value;
  if (!c) return [];
  return (s.anh.value?.canh_bao ?? []).filter((x) => x.startsWith(`${c.id}:`));
});
function trangThaiHang(d: MaDich): string | null {
  const c = comp.value;
  if (!c || c.dich_goc.includes(d) || !banSaoLuat.value.includes(d)) return null;
  const hl = dichHieuLuc(c, luat.value);
  return hl.cheDo === 'tat' ? 'luật đang tắt' : hl.cheDo === 'bong' ? 'chạy bóng' : 'đang gửi';
}

async function doiDich(d: MaDich, el: HTMLInputElement) {
  if (!comp.value) return;
  const co = el.checked;
  if (d === 'nv') { if (!co) await s.datDich(comp.value.id, (luat.value?.dich_tho ?? []).filter((x) => x.kieu !== 'nv')); }
  else await s.doiDich(comp.value.id, d, co);
  // lưu hỏng ⇒ ô về đúng trạng thái đã lưu (Vue không vá lại vì :checked không đổi)
  el.checked = dichDangGui.value.includes(d);
}
function doiCheDo(c: CheDo) { if (comp.value && (!luat.value || c !== cheDo.value)) s.doiCheDo(comp.value.id, c); }

// ── đích NV ──
const dsNv = ref<NvDich[] | null>(null);
const loiNv = ref<string | null>(null);
async function napNv() {
  if (dsNv.value) return;
  try { dsNv.value = await s.client.layNhanVien(); } catch (e) { loiNv.value = `Không tải được danh sách NV: ${(e as Error).message}`; dsNv.value = []; }
}
const nvDangGui = computed(() => (luat.value?.dich_tho ?? []).filter((d) => d.kieu === 'nv').map((d) => d.gia_tri!));
const nvChonDuoc = computed(() => (dsNv.value ?? []).filter((n) => n.trangThai === 'hoat_dong' && !nvDangGui.value.includes(n.zaloUid)));
const tenNv = (uid: string) => dsNv.value?.find((n) => n.zaloUid === uid)?.tenGoi ?? `NV …${uid.slice(-4)}`;
function themNv(el: HTMLSelectElement) {
  const uid = el.value;
  el.value = '';
  if (!uid || !comp.value) return;
  s.datDich(comp.value.id, [...(luat.value?.dich_tho ?? []), { kieu: 'nv', gia_tri: uid }]);
}
function boNv(uid: string) {
  if (!comp.value) return;
  s.datDich(comp.value.id, (luat.value?.dich_tho ?? []).filter((d) => !(d.kieu === 'nv' && d.gia_tri === uid)));
}
watch(nvDangGui, (v) => { if (v.length) napNv(); }, { immediate: true });

// ── điều hướng trong app (có router thì push, không có — khung so ảnh — để trình duyệt tự đi) ──
const router = getCurrentInstance()?.appContext.config.globalProperties.$router as { push: (p: string) => unknown } | undefined;
function diToi(e: MouseEvent, duong: string) {
  if (!router || e.ctrlKey || e.metaKey || e.shiftKey) return;
  e.preventDefault();
  router.push(duong);
}

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
  const b = new Blob([JSON.stringify({
    ghi_chu: 'Bản đồ tin — luật thông báo CRM hiện hành', danh_muc_bot: a.phien_ban,
    luat: a.luat.map(({ id, loai, dich_tho, che_do, phien_ban }) => ({ id, loai, dich: dich_tho, che_do, phien_ban })),
  }, null, 2)], { type: 'application/json' });
  const u = URL.createObjectURL(b);
  const el = document.createElement('a');
  el.href = u; el.download = 'luat-thong-bao.json'; el.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
</script>
