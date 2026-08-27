# print-agent

Agent Python chay tren PC Windows tai shop. No noi toi server ZaloCRM
qua socket.io, nhan job in hoa don (PDF base64), in ra may in HP qua
driver bang SumatraPDF CLI.

## Giao thuc server <-> agent (da CHOT, khong doi khac)

- Server dung **socket.io**, namespace `/print-agent`.
- Agent connect voi auth handshake:
  ```python
  sio.connect(server_url, auth={"token": AGENT_TOKEN, "orgId": ORG_ID},
              namespaces=["/print-agent"])
  ```
- Server -> agent, event `"job"`:
  ```json
  {"loai": "in", "job": {"id": "...", "pdfBase64": "...", "paperSize": "A5", "tray": "tray-2", "copies": 1}}
  ```
- Agent -> server, event `"ket-qua"` (namespace `/print-agent`):
  ```json
  {"jobId": "...", "trangThai": "da_in"}
  ```
  hoac khi loi:
  ```json
  {"jobId": "...", "trangThai": "loi", "loiCuoi": "mo ta loi"}
  ```
- Token sai -> `connect_error` -> agent tu dong retry/backoff (socketio
  `reconnection=True`).

## Cau truc

```
print-agent/
  agent.py             # main: doc config, noi socket.io, on('job') -> in -> emit('ket-qua')
  config.py             # doc config.ini -> dataclass Config
  inprint.py             # dung lenh in qua SumatraPDF, ho tro DRY_RUN
  config.ini.example    # mau config, copy thanh config.ini
  requirements.txt       # phu thuoc chay that (socketio client)
  requirements-dev.txt  # + pytest, de chay test
  tests/                 # pytest cho logic thuan
```

## Chay test (KHONG can Windows, KHONG can may in that)

Toan bo test trong `tests/` la **logic thuan**: parse config, dung
argv lenh in, decode base64 -> file (qua che do dry-run), va ham
xu-ly-job thuan (nhan dict -> tra dict). Khong test nao goi
SumatraPDF that hay socket.io that.

```bash
cd print-agent
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
```

Neu may ban da co `pytest` global va khong muon dung venv:

```bash
cd print-agent
pip install -r requirements-dev.txt   # hoac chi `pip install pytest`
python -m pytest -q
```

Ghi chu: cac test cho `agent.py`/`config.py` **khong can cai
`python-socketio`** — `agent.py` chi `import socketio` cuc bo ben
trong `_build_socketio_client()`, khong o dau file, nen module import
duoc va logic xu-ly-job test duoc kể ca khi chua cai socketio. Chi
`agent.py:main()` (chay that) moi can `python-socketio` cai san.

## Cai dat tren PC Windows shop (chay that)

### 1. Cai Python 3.10+

Tai tu https://www.python.org/downloads/windows/, tick **"Add
python.exe to PATH"** luc cai.

### 2. Cai SumatraPDF

Tai ban **portable** hoac cai dat tu https://www.sumatrapdfreader.org/download-free-pdf-viewer
SumatraPDF co ho tro in tu dong dong lenh qua co `-print-to` va
`-print-settings` — day la ly do chon no thay vi goi driver truc tiep.

Ghi lai duong dan day du toi `SumatraPDF.exe` (vi du
`C:\Program Files\SumatraPDF\SumatraPDF.exe`), can khi chinh
`sumatra_path` neu khong nam trong PATH.

### 3. Copy code + cai phu thuoc

```powershell
cd C:\print-agent
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

### 4. Tao config.ini

```powershell
copy config.ini.example config.ini
notepad config.ini
```

Dien: `server_url`, `token`, `org_id`, va **`printer_name` phai giong
y het** ten hien trong Windows "Devices and Printers" (hoac
`Settings > Printers & scanners`).

### 5. Verify tren may that (BAT BUOC lam thu cong o day, khong test tu dong duoc)

Cac diem sau **chi verify duoc tren may Windows that co may in HP
that noi vao** — code da viet san nhung KHONG the unit-test:

- **Chay khong dry-run va in thu 1 to thuc te**: xoa/khong set bien
  moi truong `AGENT_DRY_RUN`, chay agent, gui 1 job test tu server (hoac
  goi truc tiep `inprint.in_pdf()` tu `python` REPL) va kiem tra to giay
  in ra dung khay, dung khoi giay, dung noi dung.
- **Verify map khay giay (`tray-2` -> `bin=2`)**: SumatraPDF
  `-print-settings bin=<n>` — chi so `<n>` co the KHONG khop 1-1 voi
  thu tu khay vat ly tuy driver HP cu the. Can thu tung khay
  (`tray-1`, `tray-2`, ...) va doi chieu voi khay giay thuc te may in
  ra, roi dieu chinh mapping trong `inprint._tray_to_bin()` neu can.
- **Verify khoi giay A5 in dung kich thuoc/khong bi cat le** — mot so
  driver HP can chinh them trong Windows Printer Preferences (vi du
  chon dung "Media Type"/"Scale to fit").
- **Cai dat + chay nhu Windows service (nssm)** — xem muc ben duoi.
- **Test mat mang / mat ket noi tam thoi**: rut cap mang / tat wifi
  vai giay roi noi lai, xem agent co tu reconnect va tiep tuc nhan job
  hay khong (code da bat `reconnection=True` nhung can xac nhan tren
  moi truong mang that cua shop).

De thuan tien test buoc nay ma **chua** co server that, co the chay
dry-run tren chinh may Windows (khong can may in):

```powershell
set AGENT_DRY_RUN=1
set AGENT_DRY_RUN_DIR=C:\print-agent\dry-run-output
python -c "from inprint import in_pdf; import pathlib; print(in_pdf(pathlib.Path('mau.pdf').read_bytes(), printer='HP LaserJet M1005', paper_size='A5', tray='tray-2'))"
```

File PDF se duoc ghi ra `dry-run-output\` thay vi in that — kiem tra
file .pdf ghi ra co mo duoc va dung noi dung khong.

### 6. Chay thu agent (foreground, truoc khi cai service)

```powershell
.venv\Scripts\python agent.py config.ini
```

Kiem tra log hien "Da ket noi toi server". Neu bao loi ket noi, kiem
tra `server_url`/`token`/`org_id` trong `config.ini`.

### 7. Cai chay nen bang nssm (Windows service)

[nssm](https://nssm.cc/download) cho phep chay bat ky .exe/script nao
nhu mot Windows Service (tu khoi dong cung may, tu restart khi crash).

```powershell
# Tai nssm, giai nen, dat nssm.exe vao PATH hoac dung duong dan day du.

nssm install ZaloCRMPrintAgent "C:\print-agent\.venv\Scripts\python.exe" "C:\print-agent\agent.py" "C:\print-agent\config.ini"
nssm set ZaloCRMPrintAgent AppDirectory "C:\print-agent"
nssm set ZaloCRMPrintAgent AppStdout "C:\print-agent\logs\stdout.log"
nssm set ZaloCRMPrintAgent AppStderr "C:\print-agent\logs\stderr.log"
nssm set ZaloCRMPrintAgent Start SERVICE_AUTO_START

nssm start ZaloCRMPrintAgent
```

Kiem tra service dang chay: `services.msc` -> tim "ZaloCRMPrintAgent",
hoac `nssm status ZaloCRMPrintAgent`.

Go bo service (neu can):

```powershell
nssm stop ZaloCRMPrintAgent
nssm remove ZaloCRMPrintAgent confirm
```

**Diem can verify tren may that o buoc nay**: service co tu khoi dong
sau khi restart may khong, co tu reconnect sau khi mat mang/server
restart khong, log co ghi du de debug khong.

## Tom tat: phan nao test tu dong duoc, phan nao PHAI test tren may Windows that

| Phan | Test tu dong (pytest, moi OS) | Can may Windows that + may in that |
|---|---|---|
| Parse config.ini | Co (`tests/test_config.py`) | — |
| Dung argv lenh SumatraPDF | Co (`tests/test_inprint.py`) | — |
| Decode base64 -> file PDF (dry-run) | Co (`tests/test_inprint.py`) | — |
| Ham xu-ly-job thuan (dict -> dict) | Co (`tests/test_agent.py`) | — |
| Goi SumatraPDF that in ra giay | Khong | **Co** |
| Map khay giay (bin=<n>) dung khay vat ly | Khong | **Co** |
| Kich thuoc giay A5 khong bi cat/le | Khong | **Co** |
| Ket noi socket.io that toi server that | Khong (chi mock) | **Co** |
| Reconnect khi mat mang | Khong | **Co** |
| Chay nhu nssm service, tu khoi dong | Khong | **Co** |
