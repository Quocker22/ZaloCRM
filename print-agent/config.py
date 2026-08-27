# SPDX-License-Identifier: AGPL-3.0-or-later
"""Doc file config.ini cua print agent va tra ve Config thuan (dataclass).

Khong phu thuoc socketio / khong I/O ngoai viec doc file — de test duoc
hoan toan bang chuoi trong bo nho (parse_config_string).
"""
from __future__ import annotations

import configparser
from dataclasses import dataclass

SECTION = "agent"

REQUIRED_FIELDS = (
    "server_url",
    "token",
    "org_id",
    "printer_name",
)

# Cac field co gia tri mac dinh neu thieu trong config.ini
DEFAULT_TRAY = "tray-1"
DEFAULT_PAPER_SIZE = "A5"


class ConfigError(ValueError):
    """Loi khi config.ini thieu field bat buoc hoac sai dinh dang."""


@dataclass(frozen=True)
class Config:
    server_url: str
    token: str
    org_id: str
    printer_name: str
    tray: str = DEFAULT_TRAY
    paper_size: str = DEFAULT_PAPER_SIZE


def parse_config_string(text: str) -> Config:
    """Parse noi dung config.ini (dang chuoi) thanh Config.

    Nem ConfigError voi thong bao ro rang khi thieu section [agent] hoac
    thieu field bat buoc.
    """
    parser = configparser.ConfigParser()
    parser.read_string(text)

    if not parser.has_section(SECTION):
        raise ConfigError(
            f"config.ini thieu section [{SECTION}]"
        )

    section = parser[SECTION]

    missing = [f for f in REQUIRED_FIELDS if not section.get(f, "").strip()]
    if missing:
        raise ConfigError(
            "config.ini thieu field bat buoc: " + ", ".join(missing)
        )

    return Config(
        server_url=section.get("server_url").strip(),
        token=section.get("token").strip(),
        org_id=section.get("org_id").strip(),
        printer_name=section.get("printer_name").strip(),
        tray=section.get("tray", DEFAULT_TRAY).strip() or DEFAULT_TRAY,
        paper_size=section.get("paper_size", DEFAULT_PAPER_SIZE).strip()
        or DEFAULT_PAPER_SIZE,
    )


def load_config(path: str) -> Config:
    """Doc file config.ini tu duong dan `path` va parse thanh Config."""
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    return parse_config_string(text)
