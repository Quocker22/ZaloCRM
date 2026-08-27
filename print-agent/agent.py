# SPDX-License-Identifier: AGPL-3.0-or-later
"""Print agent: noi socket.io toi server ZaloCRM, nhan job in, goi
in_pdf(), bao ket qua ve server.

Giao thuc da CHOT (dung NGUYEN VAN tu backend/.sdd/task-agent-py-brief.md):
  - Namespace: '/print-agent'
  - Handshake auth: {'token': <AGENT_TOKEN>, 'orgId': <ORG_ID>}
  - Server -> agent: event 'job', payload
      {'loai': 'in', 'job': {'id', 'pdfBase64', 'paperSize', 'tray', 'copies'}}
  - Agent -> server: emit 'ket-qua', payload
      {'jobId', 'trangThai': 'da_in' | 'loi', 'loiCuoi'?}, namespace='/print-agent'

QUAN TRONG ve kien truc test: xu_ly_job() la HAM THUAN — nhan dict
job (+ Config) roi tra ve dict ket-qua, KHONG dong goi socketio.
File nay (agent.py) co import socketio o muc module, nhung moi logic
co the test duoc nam trong xu_ly_job() / parse_job_payload(), khong
can khoi tao Client / khong can server that.
"""
from __future__ import annotations

import logging
import sys

from config import Config, load_config
from inprint import base64_to_bytes, in_pdf

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("print-agent")

NAMESPACE = "/print-agent"

TRANG_THAI_DA_IN = "da_in"
TRANG_THAI_LOI = "loi"


class JobPayloadError(ValueError):
    """Payload 'job' tu server thieu field bat buoc / sai dinh dang."""


def parse_job_payload(payload: dict) -> dict:
    """Kiem tra + rut trich 'job' tu payload event 'job'.

    payload ky vong dang {'loai': 'in', 'job': {...}}.
    Tra ve dict job (id, pdfBase64, paperSize, tray, copies).
    Nem JobPayloadError neu thieu field bat buoc.
    """
    if not isinstance(payload, dict):
        raise JobPayloadError(f"payload phai la dict, nhan duoc {type(payload)!r}")

    job = payload.get("job")
    if not isinstance(job, dict):
        raise JobPayloadError("payload thieu 'job' hoac 'job' khong phai dict")

    required = ("id", "pdfBase64", "paperSize", "tray")
    missing = [f for f in required if not job.get(f)]
    if missing:
        raise JobPayloadError(
            "job thieu field bat buoc: " + ", ".join(missing)
        )

    return job


def xu_ly_job(job: dict, config: Config) -> dict:
    """Ham THUAN: nhan dict job (da parse) + Config, goi in, tra dict
    ket-qua theo dung giao thuc 'ket-qua' da chot.

    Khong lam I/O socket — chi goi in_pdf() (co the la dry-run qua
    bien moi truong AGENT_DRY_RUN=1) va build dict ket qua.
    Bat moi exception khi decode/in de LUON tra ve dict hop le (khong
    bao gio de loi văng ra ngoai lam agent crash / mat ket noi).
    """
    job_id = job.get("id", "")
    copies = job.get("copies", 1) or 1

    try:
        pdf_bytes = base64_to_bytes(job["pdfBase64"])
    except Exception as e:  # decode loi -> bao loi ro rang ve server
        logger.exception("Job %s: loi decode base64", job_id)
        return {
            "jobId": job_id,
            "trangThai": TRANG_THAI_LOI,
            "loiCuoi": f"loi decode pdfBase64: {e}",
        }

    try:
        ket_qua = in_pdf(
            pdf_bytes,
            printer=config.printer_name,
            paper_size=job.get("paperSize", config.paper_size),
            tray=job.get("tray", config.tray),
            copies=copies,
        )
    except Exception as e:  # phong khi in_pdf nem loi khong luong truoc
        logger.exception("Job %s: loi khong luong truoc khi in", job_id)
        return {
            "jobId": job_id,
            "trangThai": TRANG_THAI_LOI,
            "loiCuoi": f"loi khong luong truoc: {e}",
        }

    if ket_qua.ok:
        logger.info("Job %s: in thanh cong", job_id)
        return {"jobId": job_id, "trangThai": TRANG_THAI_DA_IN}

    logger.warning("Job %s: in loi: %s", job_id, ket_qua.loi)
    return {
        "jobId": job_id,
        "trangThai": TRANG_THAI_LOI,
        "loiCuoi": ket_qua.loi or "loi khong xac dinh",
    }


def xu_ly_job_payload(payload: dict, config: Config) -> dict:
    """Ket hop parse_job_payload() + xu_ly_job() thanh mot buoc, van
    la ham THUAN — dung boi on('job') handler va boi test.

    Neu payload sai dinh dang, tra ve dict ket-qua trangThai='loi' voi
    jobId rong thay vi nem exception (agent khong duoc crash vi payload
    la).
    """
    try:
        job = parse_job_payload(payload)
    except JobPayloadError as e:
        logger.error("Payload job khong hop le: %s", e)
        return {
            "jobId": (payload or {}).get("job", {}).get("id", "")
            if isinstance(payload, dict)
            else "",
            "trangThai": TRANG_THAI_LOI,
            "loiCuoi": str(e),
        }
    return xu_ly_job(job, config)


def _build_socketio_client(config: Config):
    """Tao socketio.Client va dang ky cac event handler.

    Tach rieng ham nay (thay vi de trong main()) de co the mock/patch
    khi can, nhung import socketio CHI xay ra khi ham nay duoc goi —
    module agent.py van import duoc o dau file de xu_ly_job* test
    duoc ma KHONG can cai python-socketio (import o dau ham, khong o
    dau module).
    """
    import socketio  # import cuc bo: chi can khi thuc su chay agent

    sio = socketio.Client(reconnection=True, reconnection_delay=1, reconnection_delay_max=30)

    @sio.event(namespace=NAMESPACE)
    def connect():
        logger.info("Da ket noi toi server (namespace=%s)", NAMESPACE)

    @sio.event(namespace=NAMESPACE)
    def connect_error(data):
        logger.error("Ket noi that bai (co the sai token/orgId): %s", data)

    @sio.event(namespace=NAMESPACE)
    def disconnect():
        logger.warning("Mat ket noi toi server, cho reconnect...")

    @sio.on("job", namespace=NAMESPACE)
    def on_job(payload):
        logger.info("Nhan job: %s", payload)
        ket_qua = xu_ly_job_payload(payload, config)
        sio.emit("ket-qua", ket_qua, namespace=NAMESPACE)
        logger.info("Da bao ket-qua: %s", ket_qua)

    return sio


def main(config_path: str = "config.ini") -> None:
    config = load_config(config_path)
    logger.info(
        "Khoi dong print-agent (server=%s, org=%s, printer=%s)",
        config.server_url,
        config.org_id,
        config.printer_name,
    )

    sio = _build_socketio_client(config)
    sio.connect(
        config.server_url,
        auth={"token": config.token, "orgId": config.org_id},
        namespaces=[NAMESPACE],
    )
    sio.wait()


if __name__ == "__main__":
    config_path = sys.argv[1] if len(sys.argv) > 1 else "config.ini"
    main(config_path)
