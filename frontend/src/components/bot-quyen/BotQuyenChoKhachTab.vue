<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  Tab "Cho khách" của trang Quyền bot (docs/79 T5): người giữ trang quyết bot được dùng gì khi KHÁCH hỏi thông số trong nhóm khách.
    • Tài liệu khách xem được — danh mục kho tri thức (RAG) do bot gửi lên; tick hàng loạt. MẶC ĐỊNH không tài liệu nào được dùng.
      Duyệt gắn với ĐÚNG nội dung (băm) lúc duyệt: kho nạp lại tài liệu với nội dung khác ⇒ chip "Tài liệu đã đổi — cần duyệt lại".
    • Mô tả sản phẩm đã duyệt — "Mô tả bán hàng" trên Odoo; duyệt gắn với ĐÚNG nội dung đang thấy: sửa mô tả sau đó ⇒ chip
      "Mô tả đã đổi — cần duyệt lại" và bot thôi dùng tới khi duyệt lại (K2).
  Bot đọc duyệt qua bridge trong khoảng 1 phút. Thông số đọc từ TÊN sản phẩm không cần duyệt (không hiện ở đây).
-->
<template>
  <div class="bq-goc bq-ck">
    <!-- ── Tài liệu ─────────────────────────────────────────────────────── -->
    <section class="bq-ck-phan" data-phan="tai-lieu" aria-labelledby="bq-ck-tl">
      <div class="bq-ck-dau">
        <h2 id="bq-ck-tl">Tài liệu khách xem được</h2>
        <v-btn variant="outlined" size="small" prepend-icon="mdi-refresh" :loading="tl.dangTai" @click="taiTaiLieu">Làm mới</v-btn>
      </div>
      <v-alert type="warning" variant="tonal" density="compact" class="mb-3" data-o="canh-bao-noi-bo">
        Chỉ tick tài liệu <b>công khai</b> (datasheet, catalogue, hướng dẫn lắp). <b>KHÔNG tick tài liệu nội bộ, bảng giá, báo giá,
        chiết khấu, công nợ</b> — bot trích nội dung tài liệu đã tick để trả lời khách trong nhóm.
      </v-alert>

      <v-alert v-if="tl.loi" type="error" variant="tonal" density="compact" class="mb-3" role="alert">{{ tl.loi }}</v-alert>
      <div v-if="tl.dangTai && !tl.da" class="bq-trong">Đang tải danh mục tài liệu…</div>
      <div v-else-if="tl.da && !tl.danhMuc" class="bq-trong">
        Bot chưa gửi danh mục tài liệu — chưa có gì để duyệt. Bot gửi danh mục khi khởi động và mỗi lần kho tri thức đổi.
      </div>
      <template v-else-if="tl.danhMuc">
        <p class="bq-ck-moc bq-mo">
          Danh mục bot gửi lúc {{ gio(tl.danhMuc.luc) }} · {{ tl.ds.length }} tài liệu · {{ soChoKhach }} khách xem được
        </p>
        <div class="bq-ck-loc">
          <v-text-field
            v-model="tl.tuKhoa" class="bq-ck-tim" label="Tìm tài liệu" prepend-inner-icon="mdi-magnify"
            density="compact" clearable hide-details
          />
          <div class="bq-ck-nhom-nut" role="group" aria-label="Lọc tài liệu">
            <button
              v-for="l in locTlNut" :key="l.v" type="button" class="bq-ck-loc-nut"
              :class="{ 'is-on': tl.loc === l.v, 'is-vang': l.v === 'doi_sau_duyet' && l.so > 0 }"
              :aria-pressed="tl.loc === l.v" :data-loc-tl="l.v" @click="tl.loc = l.v"
            >{{ l.chu }} <span class="bq-ck-so">{{ l.so }}</span></button>
          </div>
        </div>
        <p v-if="tl.ngoaiDanhMuc.length > 0" class="bq-ck-ngoai">
          <v-icon size="15" icon="mdi-information-outline" />
          {{ tl.ngoaiDanhMuc.length }} tài liệu đã duyệt không còn trong danh mục bot gửi (bot không dùng).
          <v-btn variant="text" size="small" @click="moHop('bo-tl', tl.ngoaiDanhMuc)">Bỏ duyệt các tài liệu này</v-btn>
        </p>

        <div v-if="tlChon.length > 0" class="bq-ck-thanh" role="region" aria-label="Thao tác hàng loạt">
          <span class="bq-ck-thanh-so">Đã chọn {{ tlChon.length }}</span>
          <v-btn
            v-if="tlChonChua.length > 0" color="primary" variant="flat" size="small" data-nut="duyet-tai-lieu"
            @click="moHop('duyet-tl', tlChonChua)"
          >Cho khách xem ({{ tlChonChua.length }})</v-btn>
          <v-btn
            v-if="tlChonDa.length > 0" color="error" variant="outlined" size="small" data-nut="bo-duyet-tai-lieu"
            @click="moHop('bo-tl', tlChonDa)"
          >Bỏ cho khách ({{ tlChonDa.length }})</v-btn>
          <v-btn variant="text" size="small" @click="tl.chon = []">Bỏ chọn</v-btn>
        </div>

        <div v-if="tlHien.length === 0" class="bq-trong">Không có tài liệu nào khớp.</div>
        <v-table v-else class="bq-bang" density="comfortable">
          <thead>
            <tr>
              <th class="bq-ck-cot-tick">
                <input
                  type="checkbox" class="bq-ck-tick" data-o="chon-het" aria-label="Chọn mọi tài liệu đang hiện"
                  :checked="tlChonHet" @change="chonHetTl(($event.target as HTMLInputElement).checked)"
                >
              </th>
              <th>Tài liệu</th>
              <th>Đoạn</th>
              <th>Cập nhật</th>
              <th>Khách</th>
              <th class="bq-cot-nut"><span class="d-sr-only">Thao tác</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in tlHien" :key="t.id" :data-tl="t.id">
              <td class="bq-ck-cot-tick" data-nhan="Chọn">
                <input v-model="tl.chon" type="checkbox" class="bq-ck-tick" :value="t.id" :aria-label="`Chọn ${t.tieuDe}`">
              </td>
              <td data-nhan="Tài liệu">
                <div class="bq-ck-ten">
                  <span class="bq-ck-ten-chu">{{ t.tieuDe }}</span>
                  <span v-if="t.loai" class="bq-chip bq-chip--xam">{{ t.loai }}</span>
                  <span v-if="t.nguon" class="bq-chip bq-chip--rong">{{ t.nguon }}</span>
                  <span
                    v-if="coVeNoiBo(t)" class="bq-chip bq-chip--do" data-o="noi-bo"
                    title="Tên hoặc nội dung có chữ/số tiền hay gặp ở tài liệu nội bộ — kiểm lại trước khi cho khách"
                  ><v-icon size="12" icon="mdi-alert-outline" />Có vẻ tài liệu nội bộ</span>
                </div>
                <v-btn
                  v-if="t.mauNoiDung" variant="text" size="x-small" class="bq-ck-xem"
                  @click="doiMo(t.id)"
                >{{ tl.mo.includes(t.id) ? 'Ẩn mẫu' : 'Xem mẫu' }}</v-btn>
                <p v-if="tl.mo.includes(t.id)" class="bq-ck-mau" data-o="mau">{{ t.mauNoiDung }}</p>
              </td>
              <td data-nhan="Đoạn"><span class="bq-nho">{{ t.soDoan }}</span></td>
              <td data-nhan="Cập nhật"><span class="bq-nho bq-mo">{{ t.capNhatLuc ? gio(t.capNhatLuc) : '—' }}</span></td>
              <td data-nhan="Khách">
                <span
                  class="bq-chip" :class="`bq-chip--${nhanTrangThaiTaiLieu(t.trangThai).mau}`" data-o="trang-thai-tl"
                  :title="nguoiDuyetChu(t.duyetBoi, t.duyetLuc)"
                >{{ nhanTrangThaiTaiLieu(t.trangThai).chu }}</span>
              </td>
              <td class="bq-cot-nut">
                <v-btn
                  v-if="t.trangThai === 'doi_sau_duyet' && t.noiDungBam" size="small" color="primary" variant="tonal"
                  :loading="tl.dangLam === t.id" @click="duyetLaiTl(t)"
                >Duyệt lại</v-btn>
              </td>
            </tr>
          </tbody>
        </v-table>
      </template>
    </section>

    <v-divider class="my-6" />

    <!-- ── Mô tả SP ─────────────────────────────────────────────────────── -->
    <section class="bq-ck-phan" data-phan="mo-ta" aria-labelledby="bq-ck-mt">
      <div class="bq-ck-dau">
        <h2 id="bq-ck-mt">Mô tả sản phẩm đã duyệt</h2>
        <v-btn variant="outlined" size="small" prepend-icon="mdi-refresh" :loading="mt.dangTai" @click="taiMoTa">Làm mới</v-btn>
      </div>
      <p class="bq-ck-giai bq-mo">
        Bot chỉ gửi khách <b>mô tả bán hàng</b> đã duyệt. Sửa mô tả (trên Odoo hoặc qua bot) thì duyệt mất hiệu lực tới khi duyệt lại.
        Thông số đọc từ <b>tên</b> sản phẩm (điện áp, số bóng/m, màu, IP…) không cần duyệt.
      </p>

      <v-alert v-if="mt.loi" type="error" variant="tonal" density="compact" class="mb-3" role="alert">{{ mt.loi }}</v-alert>
      <div v-if="mt.dangTai && !mt.da" class="bq-trong">Đang tải mô tả sản phẩm…</div>
      <div v-else-if="mt.da && !mt.danhMuc" class="bq-trong">Bot chưa gửi danh mục sản phẩm — chưa có mô tả nào để duyệt.</div>
      <template v-else-if="mt.danhMuc">
        <div class="bq-ck-loc">
          <div class="bq-ck-nhom-nut" role="group" aria-label="Lọc mô tả">
            <button
              v-for="l in locMoTaNut" :key="l.v" type="button" class="bq-ck-loc-nut" :class="{ 'is-on': mt.loc === l.v, 'is-vang': l.v === 'doi_sau_duyet' && l.so > 0 }"
              :aria-pressed="mt.loc === l.v" :data-loc="l.v" @click="doiLocMoTa(l.v)"
            >{{ l.chu }} <span class="bq-ck-so">{{ l.so }}</span></button>
          </div>
          <v-text-field
            v-model="mt.tuKhoa" class="bq-ck-tim" label="Tìm theo tên / mã" prepend-inner-icon="mdi-magnify"
            density="compact" clearable hide-details
          />
        </div>

        <div v-if="mtChon.length > 0" class="bq-ck-thanh" role="region" aria-label="Thao tác hàng loạt">
          <span class="bq-ck-thanh-so">Đã chọn {{ mtChon.length }}</span>
          <v-btn
            v-if="mtChonDuyet.length > 0" color="primary" variant="flat" size="small" data-nut="duyet-mo-ta"
            @click="moHop('duyet-mt', mtChonDuyet.map((s) => s.productId))"
          >Duyệt mô tả ({{ mtChonDuyet.length }})</v-btn>
          <v-btn
            v-if="mtChonBo.length > 0" color="error" variant="outlined" size="small" data-nut="bo-duyet-mo-ta"
            @click="moHop('bo-mt', mtChonBo.map((s) => s.productId))"
          >Bỏ duyệt ({{ mtChonBo.length }})</v-btn>
          <v-btn variant="text" size="small" @click="mt.chon = []">Bỏ chọn</v-btn>
        </div>

        <div v-if="mtHien.length === 0" class="bq-trong">Không có sản phẩm nào khớp.</div>
        <v-table v-else class="bq-bang" density="comfortable">
          <thead>
            <tr>
              <th class="bq-ck-cot-tick">
                <input
                  type="checkbox" class="bq-ck-tick" data-o="chon-het" aria-label="Chọn mọi sản phẩm đang hiện"
                  :checked="mtChonHet" @change="chonHetMt(($event.target as HTMLInputElement).checked)"
                >
              </th>
              <th>Sản phẩm</th>
              <th>Mô tả bán hàng</th>
              <th>Trạng thái</th>
              <th class="bq-cot-nut"><span class="d-sr-only">Thao tác</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in mtHien" :key="s.productId" :data-sp="s.productId">
              <td class="bq-ck-cot-tick" data-nhan="Chọn">
                <input v-model="mt.chon" type="checkbox" class="bq-ck-tick" :value="s.productId" :aria-label="`Chọn ${s.ten}`">
              </td>
              <td data-nhan="Sản phẩm">
                <div class="bq-ck-ten-chu">{{ s.ten }}</div>
                <div v-if="s.ma" class="bq-nho bq-mo bq-mono">{{ s.ma }}</div>
              </td>
              <td data-nhan="Mô tả">
                <p v-if="s.moTaBan" class="bq-ck-mo-ta">{{ s.moTaBan }}</p>
                <span v-else class="bq-mo bq-nho">(không còn mô tả)</span>
              </td>
              <td data-nhan="Trạng thái">
                <span
                  class="bq-chip" :class="`bq-chip--${nhanTrangThaiMoTa(s.trangThai).mau}`" data-o="trang-thai"
                  :title="nguoiDuyetChu(s.duyetBoi, s.duyetLuc)"
                >{{ nhanTrangThaiMoTa(s.trangThai).chu }}</span>
              </td>
              <td class="bq-cot-nut">
                <span class="bq-cac-nut">
                  <v-btn
                    v-if="coTheDuyet(s)" size="small" color="primary" variant="tonal" :loading="mt.dangLam === s.productId"
                    @click="duyetMot(s)"
                  >{{ s.trangThai === 'doi_sau_duyet' ? 'Duyệt lại' : 'Duyệt' }}</v-btn>
                  <v-btn
                    v-if="s.moTaBamDaDuyet" size="small" variant="text" :disabled="mt.dangLam === s.productId"
                    @click="moHop('bo-mt', [s.productId])"
                  >Bỏ duyệt</v-btn>
                </span>
              </td>
            </tr>
          </tbody>
        </v-table>
      </template>
    </section>

    <BotQuyenLyDoDialog
      v-model="hop.mo" :tieu-de="hop.tieuDe" :mo-ta="hop.moTa" :nut-chu="hop.nutChu" :dang-lam="hop.dangLam"
      :loi="hop.loi" :nguy-hiem="hop.nguyHiem" @xac-nhan="xacNhanHop"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive } from 'vue';
import {
  layTaiLieuChoKhach, duyetTaiLieuChoKhach, boDuyetTaiLieuChoKhach, layMoTaChoKhach, duyetMoTaChoKhach, boDuyetMoTaChoKhach,
  type DanhMucMoc, type DemMoTa, type LocMoTa, type MoTaSanPham, type NguoiDuyet, type TaiLieuChoKhach,
} from '@/api/bot-cho-khach';
import { useToast } from '@/composables/use-toast';
import { loiApi } from '@/views/settings/bot-quyen-loi';
import { dinhDangGioVN } from '@/views/settings/may-in-nhat-ky';
import { boDau } from '@/views/settings/bot-quyen-nhom';
import {
  coVeNoiBo, locTaiLieu, nhanTrangThaiMoTa, nhanTrangThaiTaiLieu, type LocTaiLieu,
} from '@/views/settings/bot-quyen-cho-khach';
import BotQuyenLyDoDialog from './BotQuyenLyDoDialog.vue';

const toast = useToast();


function gio(luc: string): string {
  return dinhDangGioVN(luc, { coNam: true }).slice(0, 16);
}
function nguoiDuyetChu(ai: NguoiDuyet | null, luc: string | null): string {
  if (!ai) return '';
  return `Duyệt bởi ${ai.fullName || 'người dùng đã bị xoá'}${luc ? ` lúc ${gio(luc)}` : ''}`;
}

// ── Tài liệu ──
const tl = reactive({
  ds: [] as TaiLieuChoKhach[], danhMuc: null as DanhMucMoc | null, ngoaiDanhMuc: [] as string[],
  dangTai: false, da: false, loi: '', tuKhoa: '' as string | null, loc: 'tat_ca' as LocTaiLieu, chon: [] as string[], mo: [] as string[],
  dangLam: null as string | null,
});
const locTlNut = computed((): Array<{ v: LocTaiLieu; chu: string; so: number }> => [
  { v: 'tat_ca', chu: 'Tất cả', so: tl.ds.length },
  { v: 'cho_khach', chu: 'Khách xem được', so: locTaiLieu(tl.ds, '', 'cho_khach').length },
  { v: 'chua', chu: 'Chưa cho khách', so: locTaiLieu(tl.ds, '', 'chua').length },
  { v: 'doi_sau_duyet', chu: 'Tài liệu đổi sau duyệt', so: locTaiLieu(tl.ds, '', 'doi_sau_duyet').length },
]);
const tlHien = computed(() => locTaiLieu(tl.ds, tl.tuKhoa ?? '', tl.loc));
const soChoKhach = computed(() => tl.ds.filter((t) => t.trangThai === 'da_duyet').length);
const tlTheoId = computed(() => new Map(tl.ds.map((t) => [t.id, t])));
const tlChon = computed(() => tl.chon.filter((id) => tlTheoId.value.has(id)));
/** Duyệt được: có nội dung (băm) và chưa hiệu lực với ĐÚNG nội dung đó (chưa duyệt / đổi sau duyệt). */
const coTheDuyetTl = (t: TaiLieuChoKhach) => !!t.noiDungBam && t.trangThai !== 'da_duyet';
const tlChonChua = computed(() => tlChon.value.filter((id) => coTheDuyetTl(tlTheoId.value.get(id)!)));
const tlChonDa = computed(() => tlChon.value.filter((id) => !!tlTheoId.value.get(id)!.noiDungBamDaDuyet));
const tlChonHet = computed(() => tlHien.value.length > 0 && tlHien.value.every((t) => tl.chon.includes(t.id)));

function chonHetTl(bat: boolean) {
  const hien = new Set(tlHien.value.map((t) => t.id));
  tl.chon = bat ? [...new Set([...tl.chon, ...hien])] : tl.chon.filter((id) => !hien.has(id));
}
function doiMo(id: string) {
  tl.mo = tl.mo.includes(id) ? tl.mo.filter((x) => x !== id) : [...tl.mo, id];
}

async function taiTaiLieu() {
  tl.dangTai = true;
  tl.loi = '';
  try {
    const r = await layTaiLieuChoKhach();
    tl.ds = r.taiLieu;
    tl.danhMuc = r.danhMuc;
    tl.ngoaiDanhMuc = r.duyetNgoaiDanhMuc;
    tl.da = true;
  } catch (e) {
    const l = loiApi(e, 'Không tải được danh mục tài liệu');
    tl.loi = l.chu;
    if (!l.daBao) toast.error(l.chu, 6000);
  } finally {
    tl.dangTai = false;
  }
}

async function duyetLaiTl(t: TaiLieuChoKhach) {
  if (!t.noiDungBam) return;
  tl.dangLam = t.id;
  try {
    await duyetTaiLieuChoKhach([{ id: t.id, noiDungBam: t.noiDungBam }]);
    toast.success(`Đã duyệt lại “${t.tieuDe}”`);
    await taiTaiLieu();
  } catch (e) {
    await baoLoiGhi(e, 'Không duyệt được tài liệu', taiTaiLieu);
  } finally {
    tl.dangLam = null;
  }
}

// ── Mô tả ──
const mt = reactive({
  ds: [] as MoTaSanPham[], danhMuc: null as DanhMucMoc | null,
  dem: { coMoTa: 0, daDuyet: 0, doiSauDuyet: 0, chuaDuyet: 0, tong: 0 } as DemMoTa,
  dangTai: false, da: false, loi: '', loc: 'co_mo_ta' as LocMoTa, tuKhoa: '' as string | null, chon: [] as number[],
  dangLam: null as number | null,
});
const locMoTaNut = computed(() => [
  { v: 'co_mo_ta' as const, chu: 'Có mô tả', so: mt.dem.coMoTa },
  { v: 'da_duyet' as const, chu: 'Đã duyệt', so: mt.dem.daDuyet },
  { v: 'doi_sau_duyet' as const, chu: 'Mô tả đổi sau duyệt', so: mt.dem.doiSauDuyet },
  { v: 'tat_ca' as const, chu: 'Tất cả SP', so: mt.dem.tong },
]);
const mtHien = computed(() => {
  const k = boDau(mt.tuKhoa ?? '');
  return k ? mt.ds.filter((s) => boDau(`${s.ten} ${s.ma ?? ''}`).includes(k)) : mt.ds;
});
const mtTheoId = computed(() => new Map(mt.ds.map((s) => [s.productId, s])));
const mtChon = computed(() => mt.chon.filter((id) => mtTheoId.value.has(id)).map((id) => mtTheoId.value.get(id)!));
const coTheDuyet = (s: MoTaSanPham) => !!s.moTaBam && s.trangThai !== 'da_duyet';
const mtChonDuyet = computed(() => mtChon.value.filter(coTheDuyet));
const mtChonBo = computed(() => mtChon.value.filter((s) => !!s.moTaBamDaDuyet));
const mtChonHet = computed(() => mtHien.value.length > 0 && mtHien.value.every((s) => mt.chon.includes(s.productId)));

function chonHetMt(bat: boolean) {
  const hien = new Set(mtHien.value.map((s) => s.productId));
  mt.chon = bat ? [...new Set([...mt.chon, ...hien])] : mt.chon.filter((id) => !hien.has(id));
}

async function taiMoTa() {
  mt.dangTai = true;
  mt.loi = '';
  try {
    const r = await layMoTaChoKhach(mt.loc);
    mt.ds = r.sanPham;
    mt.danhMuc = r.danhMuc;
    mt.dem = r.dem;
    mt.da = true;
  } catch (e) {
    const l = loiApi(e, 'Không tải được mô tả sản phẩm');
    mt.loi = l.chu;
    if (!l.daBao) toast.error(l.chu, 6000);
  } finally {
    mt.dangTai = false;
  }
}

function doiLocMoTa(v: LocMoTa) {
  if (mt.loc === v) return;
  mt.loc = v;
  mt.chon = [];
  void taiMoTa();
}

/** Lỗi ghi: báo nguyên câu; 409 (mô tả đổi / danh mục đổi) ⇒ tải lại để người duyệt thấy bản mới. */
async function baoLoiGhi(e: unknown, macDinh: string, taiLai: () => Promise<void>): Promise<string> {
  const l = loiApi(e, macDinh);
  if (!l.daBao) toast.error(l.chu, 6000);
  if (l.status === 409) await taiLai();
  return l.chu;
}

async function duyetMot(s: MoTaSanPham) {
  if (!s.moTaBam) return;
  mt.dangLam = s.productId;
  try {
    await duyetMoTaChoKhach([{ productId: s.productId, moTaBam: s.moTaBam }]);
    toast.success(`Đã duyệt mô tả “${s.ten}”`);
    await taiMoTa();
  } catch (e) {
    await baoLoiGhi(e, 'Không duyệt được mô tả', taiMoTa);
  } finally {
    mt.dangLam = null;
  }
}

// ── Hộp xác nhận hàng loạt ──
type LoaiHop = 'duyet-tl' | 'bo-tl' | 'duyet-mt' | 'bo-mt';
const hop = reactive({
  mo: false, loai: 'duyet-tl' as LoaiHop, ids: [] as Array<string | number>, tieuDe: '', moTa: '', nutChu: 'Xác nhận',
  nguyHiem: false, dangLam: false, loi: '',
});

function moHop(loai: LoaiHop, ids: Array<string | number>) {
  hop.loai = loai;
  hop.ids = [...ids];
  hop.loi = '';
  hop.nguyHiem = loai.startsWith('bo-');
  if (loai === 'duyet-tl') {
    const nghi = ids.map((id) => tlTheoId.value.get(id as string)).filter((t): t is TaiLieuChoKhach => !!t && coVeNoiBo(t));
    hop.tieuDe = `Cho khách xem ${ids.length} tài liệu?`;
    hop.moTa = (nghi.length > 0
      ? `⚠ ${nghi.length} tài liệu có vẻ nội bộ/bảng giá: ${nghi.slice(0, 5).map((t) => `“${t.tieuDe}”`).join(', ')}${nghi.length > 5 ? '…' : ''}. Kiểm lại trước khi cho khách. `
      : '') + 'Bot sẽ trích nội dung các tài liệu này để trả lời khách trong nhóm.';
    hop.nutChu = 'Cho khách xem';
  } else if (loai === 'bo-tl') {
    hop.tieuDe = `Bỏ cho khách ${ids.length} tài liệu?`;
    hop.moTa = 'Bot thôi dùng các tài liệu này khi trả lời khách (trong khoảng 1 phút).';
    hop.nutChu = 'Bỏ cho khách';
  } else if (loai === 'duyet-mt') {
    hop.tieuDe = `Duyệt mô tả ${ids.length} sản phẩm?`;
    hop.moTa = 'Duyệt đúng nội dung đang hiện. Mô tả sửa sau này phải duyệt lại.';
    hop.nutChu = 'Duyệt';
  } else {
    hop.tieuDe = `Bỏ duyệt mô tả ${ids.length} sản phẩm?`;
    hop.moTa = 'Bot thôi gửi mô tả của các sản phẩm này cho khách.';
    hop.nutChu = 'Bỏ duyệt';
  }
  hop.mo = true;
}

async function xacNhanHop(lyDo: string) {
  hop.dangLam = true;
  hop.loi = '';
  const ly = lyDo || undefined;
  const laTl = hop.loai.endsWith('-tl');
  try {
    let doi = 0;
    if (hop.loai === 'duyet-tl') {
      // Gửi ĐÚNG băm nội dung đang hiển thị — bot nạp lại nội dung khác trong lúc đó ⇒ 409 TAI_LIEU_DA_DOI, không duyệt hộ.
      const ds = (hop.ids as string[]).map((id) => tlTheoId.value.get(id)).filter((t): t is TaiLieuChoKhach => !!t?.noiDungBam);
      doi = (await duyetTaiLieuChoKhach(ds.map((t) => ({ id: t.id, noiDungBam: t.noiDungBam! })), ly)).doi;
    }
    else if (hop.loai === 'bo-tl') doi = (await boDuyetTaiLieuChoKhach(hop.ids as string[], ly)).doi;
    else if (hop.loai === 'duyet-mt') {
      const sp = (hop.ids as number[]).map((id) => mtTheoId.value.get(id)).filter((s): s is MoTaSanPham => !!s?.moTaBam);
      doi = (await duyetMoTaChoKhach(sp.map((s) => ({ productId: s.productId, moTaBam: s.moTaBam! })), ly)).doi;
    } else doi = (await boDuyetMoTaChoKhach(hop.ids as number[], ly)).doi;
    toast.success(doi > 0 ? `Đã cập nhật ${doi} mục` : 'Không có gì thay đổi');
    hop.mo = false;
    if (laTl) { tl.chon = []; await taiTaiLieu(); } else { mt.chon = []; await taiMoTa(); }
  } catch (e) {
    hop.loi = await baoLoiGhi(e, 'Không lưu được', laTl ? taiTaiLieu : taiMoTa);
  } finally {
    hop.dangLam = false;
  }
}

onMounted(() => {
  void taiTaiLieu();
  void taiMoTa();
});
</script>

<style scoped>
@import './bot-quyen.css';

.bq-ck-phan h2 { font-size: 16px; font-weight: 700; margin: 0; }
.bq-ck-dau { display: flex; align-items: center; justify-content: space-between; gap: 8px 12px; flex-wrap: wrap; margin-bottom: 10px; }
.bq-ck-moc { margin: 0 0 8px; font-size: 13px; }
.bq-ck-giai { margin: 0 0 10px; font-size: 13px; line-height: 1.5; }
.bq-ck-loc { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; margin-bottom: 10px; }
.bq-ck-tim { flex: 1 1 220px; min-width: 180px; }
.bq-ck-nhom-nut { display: inline-flex; flex-wrap: wrap; gap: 6px; }
.bq-ck-loc-nut {
  display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 9999px; font-size: 13px; font-weight: 600;
  border: 1px solid var(--bq-vien); background: transparent; color: rgb(var(--v-theme-on-surface)); cursor: pointer; min-height: 32px;
}
.bq-ck-loc-nut:hover { background: var(--bq-nen-nhe); }
.bq-ck-loc-nut:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 2px; }
.bq-ck-loc-nut.is-on { border-color: rgb(var(--v-theme-primary)); color: var(--bq-chinh); background: rgba(var(--v-theme-primary), 0.1); }
.bq-ck-loc-nut.is-vang:not(.is-on) { color: var(--bq-vang); border-color: currentColor; }
.bq-ck-so { font-variant-numeric: tabular-nums; opacity: 0.85; }
.bq-ck-thanh {
  position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px;
  margin-bottom: 8px; border: 1px solid var(--bq-vien); border-radius: 8px; background: rgb(var(--v-theme-surface));
}
.bq-ck-thanh-so { font-size: 13px; font-weight: 700; margin-right: 4px; }
.bq-ck-ngoai { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 13px; color: var(--bq-mo); margin: 0 0 8px; }
.bq-ck-cot-tick { width: 36px; }
.bq-ck-tick { width: 18px; height: 18px; accent-color: rgb(var(--v-theme-primary)); cursor: pointer; }
.bq-ck-ten { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.bq-ck-ten-chu { font-weight: 600; overflow-wrap: anywhere; }
.bq-ck-xem { margin-top: 2px; padding-inline: 4px !important; }
.bq-ck-mau, .bq-ck-mo-ta {
  margin: 4px 0 0; padding: 8px 10px; border-radius: 6px; background: var(--bq-nen-nhe); border: 1px solid var(--bq-vien);
  font-size: 13px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; max-width: 60ch;
}
.bq-ck-mo-ta { margin: 0; max-height: 9.5em; overflow: auto; }
@media (max-width: 700px) {
  .bq-ck-cot-tick { width: auto; }
  .bq-ck-tim { flex-basis: 100%; }
  .bq-ck-mau, .bq-ck-mo-ta { max-width: none; }
}
</style>
