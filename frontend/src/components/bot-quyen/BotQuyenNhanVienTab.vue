<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  Tab "Nhân viên" của trang Quyền bot (docs/77 §3.3): ai là nhân viên với bot (theo Zalo uid), vai gì,
  đang hoạt động / khoá / đã nghỉ, gắn tài khoản CRM nào. Thêm / Sửa qua BotQuyenNhanVienDialog (lý do khi
  hạ / khoá, 409 ADMIN_CUOI hiện nguyên câu backend). Không xoá cứng — cho nghỉ bằng trạng thái. Bên dưới là "Chờ gán —
  người đã nhắn cho shop" (BotQuyenChoGan, docs/77 §8): người đã gán không còn ở đó.
  Cột "Gọi là" (docs/79 T1): bot gọi người này là Anh / Chị (trống ⇒ "anh/chị"). Chọn là lưu ngay. CRM chỉ GỢI Ý từ giới
  tính Zalo (chip + "Dùng"); "Áp gợi ý đã xác nhận" mở hộp liệt kê TỪNG người + gợi ý, xác nhận xong mới áp cho mọi dòng
  CHƯA chọn có gợi ý từ giới tính NV đã XÁC NHẬN trên CRM (dấu gioi_tinh_xac_nhan_luc — không phải khoá cũ).
-->
<template>
  <section class="bq-goc" aria-label="Nhân viên của bot">
    <div class="bq-nv-dau">
      <p class="bq-nv-mo-ta bq-mo">
        Bot nhận ra nhân viên theo <b>Zalo uid</b> — mỗi nick Zalo thấy cùng một người bằng một uid khác, nên một nhân viên
        có thể có nhiều uid. Máy <b>tự thêm</b> uid ở nick khác khi <b>globalId đọc từ Zalo trùng</b>; khi chỉ thấy <b>tin nhắn
        trùng</b> trong nhóm chung thì chỉ <b>đề xuất</b> — bấm “Nối” / “Không phải”. Cách nhanh nhất: chọn người trong “Chờ gán” bên dưới rồi bấm <b>Gán</b>
        (hoặc tab <b>Nhóm</b> → <b>Thành viên</b> → “Đặt làm nhân viên”).
      </p>
      <div class="bq-cac-nut">
        <v-btn variant="outlined" size="small" prepend-icon="mdi-refresh" :loading="dangTai" @click="tai">Làm mới</v-btn>
        <v-btn
          v-if="dsApHangLoat.length > 0"
          variant="tonal"
          color="primary"
          size="small"
          prepend-icon="mdi-account-check-outline"
          data-nut="ap-goi-y-hang-loat"
          title="Đặt “Gọi là” theo giới tính NV đã xác nhận trên CRM — chỉ cho người chưa chọn"
          :loading="dangApHangLoat"
          @click="moHopApGoiY"
        >Áp gợi ý đã xác nhận ({{ dsApHangLoat.length }})</v-btn>
        <v-btn color="primary" variant="flat" size="small" prepend-icon="mdi-plus" @click="moThem">Thêm nhân viên</v-btn>
      </div>
    </div>

    <v-alert
      v-if="!dangTai && !loiTai && ds.length > 0 && soAdmin === 0"
      type="warning" variant="tonal" density="compact" class="mb-3"
    >
      Chưa có ai vai Quản trị đang hoạt động — nên đặt ít nhất một người.
    </v-alert>
    <v-alert v-if="loiTai" type="error" variant="tonal" density="compact" class="bq-loi mb-3" role="alert">{{ loiTai }}</v-alert>
    <v-progress-linear v-if="dangTai && ds.length > 0" indeterminate color="primary" />

    <div v-if="dangTai && ds.length === 0" class="bq-trong">Đang tải danh sách nhân viên…</div>
    <div v-else-if="!loiTai && ds.length === 0" class="bq-trong">
      Chưa có nhân viên nào — bot chưa biết ai là nhân viên. Thêm từ tab Nhóm → Thành viên, hoặc bấm “Thêm nhân viên”.
    </div>

    <v-table v-else-if="ds.length > 0" class="bq-bang" density="comfortable">
      <thead>
        <tr>
          <th>Tên gọi</th>
          <th>Gọi là</th>
          <th>Zalo uid</th>
          <th>Vai</th>
          <th>Trạng thái</th>
          <th>Tài khoản CRM</th>
          <th>Ghi chú</th>
          <th>Cập nhật</th>
          <th class="bq-cot-nut"><span class="d-sr-only">Thao tác</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="nv in ds" :key="nv.id" :data-id="nv.id">
          <td data-nhan="Tên gọi"><span class="bq-ten">{{ nv.tenGoi }}</span></td>
          <td data-nhan="Gọi là">
            <div class="bq-goi">
              <v-select
                :model-value="nv.goi ?? ''"
                data-o="goi"
                class="bq-goi-chon"
                :items="DS_GOI"
                item-title="title"
                item-value="value"
                density="compact"
                variant="outlined"
                hide-details
                :disabled="dangLuuGoi.has(nv.id)"
                :aria-label="`Bot gọi ${nv.tenGoi} là`"
                @update:model-value="(g: string | null) => datGoi(nv, g === 'anh' || g === 'chi' ? g : null)"
              />
              <div v-if="coGoiYKhac(nv)" class="bq-goi-y" :data-goi-y="nv.goiNguon">
                <span class="bq-nho" :class="nv.goiNguon === 'khoa_tay' ? 'bq-goi-y--chac' : 'bq-mo'">{{ cauGoiY(nv) }}</span>
                <v-btn
                  size="x-small"
                  variant="tonal"
                  color="primary"
                  data-nut="nhan-goi-y"
                  :disabled="dangLuuGoi.has(nv.id)"
                  :aria-label="`Dùng gợi ý: gọi ${nv.tenGoi} là ${nhanGoi(nv.goiGoiY)}`"
                  @click="datGoi(nv, nv.goiGoiY ?? null)"
                >Dùng</v-btn>
              </div>
              <span v-else-if="!nv.goi && cauKhongGoiY(nv)" class="bq-nho bq-mo">{{ cauKhongGoiY(nv) }}</span>
            </div>
          </td>
          <td data-nhan="Zalo uid">
            <div class="bq-uids">
              <span v-for="x in uidsCua(nv)" :key="x.zaloUid" class="bq-uid" :data-uid="x.zaloUid">
                <span class="bq-mono">{{ x.zaloUid }}</span>
                <span class="bq-nho bq-mo" :title="moTaBangChung(x) || undefined">
                  {{ x.nick ? `nick ${x.nick.ten}` : 'nick chưa rõ' }}{{ nhanNguonUid(x.nguon) ? ` · ${nhanNguonUid(x.nguon)}` : '' }}
                </span>
                <v-btn
                  icon="mdi-content-copy"
                  size="x-small"
                  variant="text"
                  density="comfortable"
                  :aria-label="`Sao chép Zalo uid của ${nv.tenGoi}`"
                  title="Sao chép"
                  @click="saoChep(x.zaloUid)"
                />
                <v-btn
                  v-if="goDuoc(x, nv.zaloUid)"
                  icon="mdi-link-off"
                  size="x-small"
                  variant="text"
                  density="comfortable"
                  color="error"
                  data-nut="go-uid"
                  :aria-label="`Gỡ Zalo ${x.zaloUid} khỏi ${nv.tenGoi}`"
                  title="Gỡ uid này (máy không nối lại)"
                  @click="moHop({ loai: 'go', nv, uid: x.zaloUid })"
                />
              </span>
              <div v-for="d in nv.deXuat ?? []" :key="`dx-${d.zaloUid}`" class="bq-de-xuat" :data-de-xuat="d.zaloUid">
                <span class="bq-nho">{{ moTaDeXuat(d) }}</span>
                <span class="bq-de-xuat-nut">
                  <v-btn size="x-small" color="primary" variant="tonal" data-nut="noi-de-xuat" @click="moHop({ loai: 'noi', nv, uid: d.zaloUid, moTa: moTaDeXuat(d) })">Nối</v-btn>
                  <v-btn size="x-small" variant="text" data-nut="tu-choi-de-xuat" @click="moHop({ loai: 'tu_choi', nv, uid: d.zaloUid, moTa: moTaDeXuat(d) })">Không phải</v-btn>
                </span>
              </div>
            </div>
          </td>
          <td data-nhan="Vai"><span class="bq-chip" :class="nv.vai === 'cong_ty' ? 'bq-chip--xam' : 'bq-chip--nv'">{{ nhanVai(nv.vai) }}</span></td>
          <td data-nhan="Trạng thái"><span class="bq-chip" :class="`bq-chip--${MAU_TRANG_THAI[nv.trangThai] ?? 'xam'}`">{{ nhanTrangThai(nv.trangThai) }}</span></td>
          <td data-nhan="Tài khoản CRM"><span class="bq-nho" :class="{ 'bq-mo': !nv.user }">{{ nv.user?.fullName ?? '—' }}</span></td>
          <td data-nhan="Ghi chú"><span class="bq-nho bq-ghi-chu" :class="{ 'bq-mo': !nv.ghiChu }">{{ nv.ghiChu || '—' }}</span></td>
          <td data-nhan="Cập nhật">
            <div class="bq-nho">
              <div>{{ gio(nv.capNhatLuc) }}</div>
              <div v-if="nv.capNhatBoi" class="bq-mo">{{ nv.capNhatBoi.fullName }}</div>
            </div>
          </td>
          <td class="bq-cot-nut">
            <v-btn size="small" variant="outlined" prepend-icon="mdi-pencil-outline" @click="moSua(nv)">Sửa</v-btn>
          </td>
        </tr>
      </tbody>
    </v-table>

    <BotQuyenChoGan ref="choGan" :nguoi-dung-crm="nguoiDungCrm" :nhan-vien="ds" @da-gan="tai" />

    <BotQuyenNhanVienDialog
      v-model="hop"
      :che-do="dangSua ? 'sua' : 'tao'"
      :nhan-vien="dangSua"
      :nguoi-dung-crm="nguoiDungCrm"
      @da-luu="daLuu"
    />

    <!-- "Áp gợi ý đã xác nhận": hộp xác nhận liệt kê TỪNG người + gợi ý trước khi ghi (tự soát P2-6). -->
    <BotQuyenLyDoDialog
      v-model="hopAp.mo"
      :tieu-de="`Đặt “Gọi là” cho ${hopAp.ds.length} người?`"
      mo-ta="Theo giới tính NV đã xác nhận trên CRM — chỉ người CHƯA chọn. Bot áp trong khoảng 1 phút."
      nut-chu="Áp gợi ý"
      :dang-lam="dangApHangLoat"
      :loi="hopAp.loi"
      @xac-nhan="apGoiYHangLoat"
    >
      <ul class="bq-ap-ds" data-o="ds-ap-goi-y">
        <li v-for="nv in hopAp.ds" :key="nv.id">{{ nv.tenGoi }} → {{ nhanGoi(nv.goiGoiY) }}</li>
      </ul>
    </BotQuyenLyDoDialog>
    <BotQuyenLyDoDialog
      v-model="hopLyDo"
      :tieu-de="viec ? TIEU_DE[viec.loai](viec) : ''"
      :mo-ta="viec ? MO_TA[viec.loai](viec) : ''"
      :bat-buoc="viec?.loai === 'go'"
      :nut-chu="viec ? NUT[viec.loai] : ''"
      :nguy-hiem="viec?.loai === 'go'"
      :dang-lam="dangLam"
      :loi="loiViec"
      @xac-nhan="lamViec"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  layDanhSachNhanVien, goUidNhanVien, noiDeXuat, tuChoiDeXuat, suaNhanVien, type GoiNv, type NguoiDungCrm, type NhanVien,
} from '@/api/bot-quyen';
import { goDuoc, moTaBangChung, moTaDeXuat, nhanNguonUid } from '@/views/settings/bot-quyen-uid';
import BotQuyenLyDoDialog from './BotQuyenLyDoDialog.vue';
import { useToast } from '@/composables/use-toast';
import { nhanTrangThai, nhanVai } from '@/views/settings/bot-quyen-luat';
import { loiApi } from '@/views/settings/bot-quyen-loi';
import { dinhDangGioVN } from '@/views/settings/may-in-nhat-ky';
import BotQuyenNhanVienDialog from './BotQuyenNhanVienDialog.vue';
import BotQuyenChoGan from './BotQuyenChoGan.vue';
import { DS_GOI, nhanGoi, cauGoiY, cauKhongGoiY, coGoiYKhac, dongApHangLoat } from '@/views/settings/bot-quyen-goi';

defineProps<{ nguoiDungCrm: NguoiDungCrm[] }>();

const MAU_TRANG_THAI: Readonly<Record<string, string>> = { hoat_dong: 'xanh', khoa: 'vang', nghi: 'do' };

const toast = useToast();
const ds = ref<NhanVien[]>([]);
const dangTai = ref(false);
const loiTai = ref('');
const soAdmin = computed(() => ds.value.filter((nv) => nv.vai === 'admin' && nv.trangThai === 'hoat_dong').length);

function gio(luc: string): string {
  return dinhDangGioVN(luc, { coNam: true }).slice(0, 16);
}

let lanTai = 0;
async function tai() {
  const lan = ++lanTai;
  dangTai.value = true;
  loiTai.value = '';
  try {
    const moi = await layDanhSachNhanVien();
    if (lan !== lanTai) return;
    ds.value = moi;
  } catch (e) {
    if (lan !== lanTai) return;
    const l = loiApi(e, 'Không tải được danh sách nhân viên');
    loiTai.value = l.chu;
    if (!l.daBao) toast.error(l.chu, 6000);
  } finally {
    if (lan === lanTai) dangTai.value = false;
  }
}

/** Mọi uid (mỗi nick một uid — docs/77 §8b); bản cũ không có `uids` ⇒ uid chính. */
function uidsCua(nv: NhanVien) {
  return nv.uids?.length ? nv.uids : [{ zaloUid: nv.zaloUid, nick: null, nguon: 'chon', bangChung: null }];
}

async function saoChep(uid: string) {
  try {
    await navigator.clipboard.writeText(uid);
    toast.success('Đã sao chép Zalo uid');
  } catch {
    toast.error('Không sao chép được — chọn và sao chép tay.');
  }
}

const choGan = ref<InstanceType<typeof BotQuyenChoGan> | null>(null);

/** Thêm tay / sửa xong ⇒ tải lại cả hai danh sách (người vừa thêm rời "Chờ gán"). */
async function daLuu() {
  await tai();
  void choGan.value?.tai();
}

const hop = ref(false);
const dangSua = ref<NhanVien | null>(null);

function moThem() {
  dangSua.value = null;
  hop.value = true;
}

function moSua(nv: NhanVien) {
  dangSua.value = nv;
  hop.value = true;
}

// ── Gỡ uid / Nối / Không phải (docs/77 §8b-an-toàn) ──
type Viec = { loai: 'go' | 'noi' | 'tu_choi'; nv: NhanVien; uid: string; moTa?: string };
const TIEU_DE: Record<Viec['loai'], (v: Viec) => string> = {
  go: (v) => `Gỡ Zalo ${v.uid} khỏi “${v.nv.tenGoi}”?`,
  noi: (v) => `Nối Zalo ${v.uid} vào “${v.nv.tenGoi}”?`,
  tu_choi: (v) => `Zalo ${v.uid} KHÔNG phải “${v.nv.tenGoi}”?`,
};
const MO_TA: Record<Viec['loai'], (v: Viec) => string> = {
  go: () => 'Bot sẽ thôi nhận Zalo này là người này (ở lần đồng bộ kế, ~1 phút). Máy sẽ KHÔNG tự nối lại uid này cho người này.',
  noi: (v) => `${v.moTa ?? ''}. Bot sẽ nhận Zalo này là “${v.nv.tenGoi}” với cùng vai và trạng thái. Chỉ nối khi chắc là cùng người.`,
  tu_choi: (v) => `${v.moTa ?? ''}. Máy sẽ không đề xuất lại.`,
};
const NUT: Record<Viec['loai'], string> = { go: 'Gỡ', noi: 'Nối', tu_choi: 'Không phải' };

const hopLyDo = ref(false);
const viec = ref<Viec | null>(null);
const dangLam = ref(false);
const loiViec = ref('');

function moHop(v: Viec) {
  viec.value = v;
  loiViec.value = '';
  hopLyDo.value = true;
}

async function lamViec(lyDo: string) {
  const v = viec.value;
  if (!v) return;
  dangLam.value = true;
  loiViec.value = '';
  try {
    if (v.loai === 'go') await goUidNhanVien(v.nv.id, v.uid, lyDo);
    else if (v.loai === 'noi') await noiDeXuat(v.nv.id, v.uid, lyDo || undefined);
    else await tuChoiDeXuat(v.nv.id, v.uid, lyDo || undefined);
    toast.success(v.loai === 'go' ? 'Đã gỡ — bot áp trong khoảng 1 phút.' : v.loai === 'noi' ? 'Đã nối — bot áp trong khoảng 1 phút.' : 'Đã ghi “không phải”.');
    hopLyDo.value = false;
    await daLuu();
  } catch (e) {
    const l = loiApi(e, 'Không làm được');
    loiViec.value = l.chu;
    if (!l.daBao) toast.error(l.chu, 6000);
  } finally {
    dangLam.value = false;
  }
}

// ── "Gọi là" (docs/79 T1) — chọn là lưu ngay; gợi ý chỉ áp khi người giữ trang bấm ──
const dangLuuGoi = ref<Set<string>>(new Set());
const dangApHangLoat = ref(false);
const dsApHangLoat = computed(() => dongApHangLoat(ds.value));

function thayDong(moi: NhanVien | undefined) {
  if (!moi) return;
  const i = ds.value.findIndex((x) => x.id === moi.id);
  if (i >= 0) ds.value.splice(i, 1, { ...ds.value[i], ...moi });
}

async function datGoi(nv: NhanVien, goi: GoiNv | null) {
  if ((nv.goi ?? null) === goi || dangLuuGoi.value.has(nv.id)) return;
  dangLuuGoi.value = new Set([...dangLuuGoi.value, nv.id]);
  try {
    const { nhanVien } = await suaNhanVien(nv.id, { goi });
    thayDong(nhanVien);
    toast.success(goi ? `Bot sẽ gọi ${nv.tenGoi} là “${nhanGoi(goi)}” (áp trong khoảng 1 phút).` : `Đã bỏ chọn — bot gọi ${nv.tenGoi} là “anh/chị”.`);
  } catch (e) {
    const l = loiApi(e, 'Không lưu được “Gọi là”');
    if (!l.daBao) toast.error(l.chu, 6000);
    await tai();
  } finally {
    const s = new Set(dangLuuGoi.value);
    s.delete(nv.id);
    dangLuuGoi.value = s;
  }
}

const hopAp = ref<{ mo: boolean; ds: NhanVien[]; loi: string }>({ mo: false, ds: [], loi: '' });

/** Chụp danh sách LÚC MỞ hộp — người giữ trang xác nhận đúng những người đang thấy, không phải danh sách đổi sau đó. */
function moHopApGoiY() {
  if (dsApHangLoat.value.length === 0) return;
  hopAp.value = { mo: true, ds: [...dsApHangLoat.value], loi: '' };
}

async function apGoiYHangLoat(lyDo: string) {
  const dsAp = hopAp.value.ds;
  if (dsAp.length === 0) return;
  dangApHangLoat.value = true;
  let xong = 0;
  let loi = '';
  try {
    for (const nv of dsAp) {
      try {
        await suaNhanVien(nv.id, { goi: nv.goiGoiY ?? null, ...(lyDo ? { lyDo } : {}) });
        xong++;
      } catch (e) {
        loi = loiApi(e, 'Không lưu được').chu;
      }
    }
    if (xong > 0) toast.success(`Đã áp gợi ý cho ${xong} người — bot áp trong khoảng 1 phút.`);
    if (loi) {
      hopAp.value.loi = `${dsAp.length - xong} người chưa áp được: ${loi}`;
      toast.error(hopAp.value.loi, 6000);
    } else {
      hopAp.value.mo = false;
    }
  } finally {
    dangApHangLoat.value = false;
    await tai();
  }
}

onMounted(tai);
</script>

<style scoped>
@import './bot-quyen.css';

.bq-nv-dau { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.bq-nv-mo-ta { margin: 0; font-size: 13px; flex: 1 1 280px; }
.bq-ten { font-weight: 600; overflow-wrap: anywhere; }
.bq-uids { display: flex; flex-direction: column; gap: 2px; }
.bq-uid { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; overflow-wrap: anywhere; }
.bq-ghi-chu { display: inline-block; max-width: 220px; overflow-wrap: anywhere; }
.bq-de-xuat {
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-top: 4px; padding: 4px 8px;
  border: 1px dashed var(--bq-vien); border-radius: 6px; max-width: 420px; overflow-wrap: anywhere;
}
.bq-de-xuat-nut { display: inline-flex; gap: 4px; }
.bq-goi { display: flex; flex-direction: column; gap: 4px; min-width: 128px; max-width: 240px; }
.bq-goi-chon { max-width: 150px; }
.bq-goi-y { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; overflow-wrap: anywhere; }
.bq-goi-y--chac { color: var(--bq-xanh); font-weight: 600; }
.bq-ap-ds { margin: 8px 0 0; padding-left: 20px; max-height: 240px; overflow: auto; font-size: 13px; line-height: 1.6; }
@media (max-width: 700px) {
  .bq-goi { max-width: none; }
}
</style>
