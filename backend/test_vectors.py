"""The committed signer test vectors must match the server's sign() exactly.

The Android SignerTest loads the same JSON, so a passing pair of tests proves
Kotlin and Python agree on the signing format.
"""
import json
from pathlib import Path

import main

VECTORS = json.loads(Path(__file__).with_name("test_vectors.json").read_text(encoding="utf-8"))


def test_at_least_three_vectors_cover_required_shapes():
    names = {v["name"] for v in VECTORS}
    assert {"get_with_query", "post_json_body", "post_empty_body"} <= names


def test_python_reproduces_every_vector():
    for v in VECTORS:
        body = v["body"].encode("utf-8")
        assert main.sha256_hex(body) == v["body_sha256"], v["name"]
        got = main.sign(v["secret"], v["method"], v["path_with_query"], v["ts"], v["nonce"], body)
        assert got == v["expected_sig"], v["name"]


def test_vector_is_accepted_by_live_gate(api, clock, monkeypatch):
    """End to end: a request signed exactly as in vector 0 passes the real gate."""
    from conftest import join
    st = join(api)
    v = next(x for x in VECTORS if x["name"] == "get_with_query")
    monkeypatch.setattr(main.SESSIONS[st.sid].clients[st.student], "secret", v["secret"])
    clock["t"] = float(v["ts"])
    main.SESSIONS[st.sid].ends_at = clock["t"] + 600
    h = {"X-FL-Session": st.sid, "X-FL-Student": st.student, "X-FL-Ts": v["ts"],
         "X-FL-Nonce": v["nonce"], "X-FL-Sig": v["expected_sig"]}
    assert api.get(v["path_with_query"], headers=h).status_code == 200
