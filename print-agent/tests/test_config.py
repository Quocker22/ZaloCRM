# SPDX-License-Identifier: AGPL-3.0-or-later
import pytest

from config import Config, ConfigError, parse_config_string

VALID_CONFIG = """
[agent]
server_url = https://crm.example.com
token = abc123
org_id = org-1
printer_name = HP LaserJet M1005
tray = tray-2
paper_size = A5
"""

MINIMAL_CONFIG = """
[agent]
server_url = https://crm.example.com
token = abc123
org_id = org-1
printer_name = HP LaserJet M1005
"""


def test_parse_valid_config_returns_config():
    cfg = parse_config_string(VALID_CONFIG)
    assert cfg == Config(
        server_url="https://crm.example.com",
        token="abc123",
        org_id="org-1",
        printer_name="HP LaserJet M1005",
        tray="tray-2",
        paper_size="A5",
    )


def test_parse_minimal_config_uses_defaults():
    cfg = parse_config_string(MINIMAL_CONFIG)
    assert cfg.tray == "tray-1"
    assert cfg.paper_size == "A5"


@pytest.mark.parametrize(
    "field",
    ["server_url", "token", "org_id", "printer_name"],
)
def test_missing_required_field_raises_clear_error(field):
    lines = [l for l in MINIMAL_CONFIG.strip().splitlines() if not l.startswith(field)]
    broken = "\n".join(lines)
    with pytest.raises(ConfigError) as exc_info:
        parse_config_string(broken)
    assert field in str(exc_info.value)


def test_missing_section_raises_clear_error():
    with pytest.raises(ConfigError, match=r"\[agent\]"):
        parse_config_string("[khong-phai-agent]\nfoo = bar\n")


def test_empty_required_field_raises_error():
    text = MINIMAL_CONFIG.replace("token = abc123", "token = ")
    with pytest.raises(ConfigError, match="token"):
        parse_config_string(text)
