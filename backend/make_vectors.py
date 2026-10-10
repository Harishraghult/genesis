"""Generate backend/test_vectors.json from the server's own sign() function.

Run: python make_vectors.py
The Kotlin unit test (android/app/src/test/.../SignerTest.kt) reads the same file.
"""
import json
from pathlib import Path

from main import sha256_hex, sign

SECRET = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"

CASES = [
    {"name": "get_with_query", "method": "GET", "path_with_query": "/api/client/heartbeat?vpn=1",
     "ts": "1760000000", "nonce": "a1b2c3d4e5f60718", "body": ""},
    {"name": "post_json_body", "method": "POST", "path_with_query": "/api/client/event",
     "ts": "1760000015", "nonce": "0f1e2d3c4b5a6978",
     "body": '{"type":"vpn_started","detail":"tunnel up"}'},
    {"name": "post_empty_body", "method": "POST", "path_with_query": "/api/client/leave",
     "ts": "1760000030", "nonce": "ffeeddccbbaa9988", "body": ""},
    {"name": "get_portal_utf8_encoded_path", "method": "GET", "path_with_query": "/portal/notes%C3%A9?x=1&y=two",
     "ts": "1760000045", "nonce": "n0nce-with-dash", "body": ""},
    {"name": "post_utf8_body", "method": "POST", "path_with_query": "/api/client/event",
     "ts": "1760000060", "nonce": "1234567890abcdef", "body": '{"type":"note","detail":"caf\u00e9 \u2713"}'},
]


def build():
    out = []
    for c in CASES:
        body = c["body"].encode("utf-8")
        out.append({**c, "secret": SECRET, "body_sha256": sha256_hex(body),
                    "expected_sig": sign(SECRET, c["method"], c["path_with_query"], c["ts"], c["nonce"], body)})
    return out


if __name__ == "__main__":
    path = Path(__file__).with_name("test_vectors.json")
    path.write_text(json.dumps(build(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {path}")
