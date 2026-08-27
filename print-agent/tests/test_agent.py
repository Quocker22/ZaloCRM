# SPDX-License-Identifier: AGPL-3.0-or-later
"""Test cho phan LOGIC THUAN cua agent.py: parse_job_payload, xu_ly_job,
xu_ly_job_payload. KHONG import socketio (agent.py chi import socketio
cuc bo trong _build_socketio_client(), nen module nay import duoc va
test duoc ma khong can cai python-socketio)."""
import base64

import pytest

from agent import (
    JobPayloadError,
    parse_job_payload,
    xu_ly_job,
    xu_ly_job_payload,
)
from config import Config

FAKE_PDF_BYTES = b"%PDF-1.4 fake\n%%EOF"
FAKE_PDF_B64 = base64.b64encode(FAKE_PDF_BYTES).decode()


@pytest.fixture
def config():
    return Config(
        server_url="https://crm.example.com",
        token="tok",
        org_id="org-1",
        printer_name="HP LaserJet M1005",
        tray="tray-1",
        paper_size="A5",
    )


@pytest.fixture(autouse=True)
def dry_run(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_DRY_RUN", "1")
    monkeypatch.setenv("AGENT_DRY_RUN_DIR", str(tmp_path / "dry-run-output"))


def valid_payload(**overrides):
    job = {
        "id": "job-1",
        "pdfBase64": FAKE_PDF_B64,
        "paperSize": "A5",
        "tray": "tray-2",
        "copies": 1,
    }
    job.update(overrides)
    return {"loai": "in", "job": job}


class TestParseJobPayload:
    def test_parse_valid_payload(self):
        job = parse_job_payload(valid_payload())
        assert job["id"] == "job-1"
        assert job["paperSize"] == "A5"

    def test_missing_job_key_raises(self):
        with pytest.raises(JobPayloadError):
            parse_job_payload({"loai": "in"})

    def test_payload_not_dict_raises(self):
        with pytest.raises(JobPayloadError):
            parse_job_payload("khong-phai-dict")

    @pytest.mark.parametrize("field", ["id", "pdfBase64", "paperSize", "tray"])
    def test_missing_required_field_raises(self, field):
        payload = valid_payload()
        del payload["job"][field]
        with pytest.raises(JobPayloadError, match=field):
            parse_job_payload(payload)


class TestXuLyJob:
    def test_job_hop_le_tra_ve_da_in(self, config):
        job = parse_job_payload(valid_payload())
        ket_qua = xu_ly_job(job, config)
        assert ket_qua == {"jobId": "job-1", "trangThai": "da_in"}

    def test_pdf_base64_hong_tra_ve_loi(self, config):
        job = parse_job_payload(valid_payload(pdfBase64="!!!khong-phai-base64!!!"))
        ket_qua = xu_ly_job(job, config)
        assert ket_qua["jobId"] == "job-1"
        assert ket_qua["trangThai"] == "loi"
        assert "loiCuoi" in ket_qua

    def test_tray_sai_dinh_dang_tra_ve_loi_khong_crash(self, config):
        job = parse_job_payload(valid_payload(tray="khay-la"))
        ket_qua = xu_ly_job(job, config)
        assert ket_qua["trangThai"] == "loi"
        assert ket_qua["jobId"] == "job-1"

    def test_copies_mac_dinh_1_khi_thieu(self, config):
        payload = valid_payload()
        del payload["job"]["copies"]
        job = parse_job_payload(payload)
        ket_qua = xu_ly_job(job, config)
        assert ket_qua["trangThai"] == "da_in"


class TestXuLyJobPayload:
    def test_payload_hop_le_end_to_end(self, config):
        ket_qua = xu_ly_job_payload(valid_payload(), config)
        assert ket_qua == {"jobId": "job-1", "trangThai": "da_in"}

    def test_payload_sai_dinh_dang_tra_ve_dict_loi_khong_nem_exception(self, config):
        ket_qua = xu_ly_job_payload({"loai": "in"}, config)
        assert ket_qua["trangThai"] == "loi"
        assert "loiCuoi" in ket_qua

    def test_payload_none_khong_crash(self, config):
        ket_qua = xu_ly_job_payload(None, config)
        assert ket_qua["trangThai"] == "loi"
