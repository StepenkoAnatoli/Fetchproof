#!/usr/bin/env python3
"""Offline qualification-ledger canonical hash and Ed25519 conformance runner.

This uses only Python's standard library.  Its Ed25519 verifier is intentionally
verification-only and accepts the vector packet's raw public keys; it never
creates, reads, or writes private key material.
"""

from __future__ import annotations

import sys as _sys
from pathlib import Path as _Path
_sys.path.insert(0, str(_Path(__file__).resolve().parent))

import argparse
import base64
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

# Canonicalisation, hashing, packet parsing and report rendering are SHARED with the
# other Python runners (research-kit/bin/conformance_common.py). They were duplicated
# in three files until 2026-09-20, and two of the copies had already drifted.
from conformance_common import (
    ConformanceError,
    canonical_json as _canonical_json,
    digest,
    js_number,
    json_string,
    parse_json_no_duplicates,
    read_packet,
    report_json,
    write_report,
    require_unique_vector_ids,
)



PROFILE = "researcher-benchmark-c14n-v1"
VERSION = "1.0.0"
HEX = re.compile(r"^[0-9a-f]+$")
BASE64URL = re.compile(r"^[A-Za-z0-9_-]+$")

# Edwards25519 constants from RFC 8032, section 5.1.
Q = 2**255 - 19
L = 2**252 + 27742317777372353535851937790883648493
D = (-121665 * pow(121666, Q - 2, Q)) % Q
SQRT_M1 = pow(2, (Q - 1) // 4, Q)
BASE = (
    15112221349535400772501151409588531511454012693041857206046113283949847762202,
    46316835694926478169428394003475163141307993866256225615783033603165251855960,
)


class VectorPacketError(ConformanceError):
    """This runner's name for a refused packet. Shared base so the three agree."""


# This runner's float policy, named rather than implied (see conformance_common).
def canonical_json(value):
    return _canonical_json(value, float_policy="reject")


def load_vectors(path: str | Path) -> dict[str, Any]:
    raw = Path(path).read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        raise VectorPacketError("UTF-8 BOM is not permitted")
    try:
        packet = parse_json_no_duplicates(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, ConformanceError, RecursionError) as error:
        raise VectorPacketError(str(error)) from error
    if not isinstance(packet, dict):
        raise VectorPacketError("packet must be an object")
    if packet.get("packetVersion") != VERSION:
        raise VectorPacketError(f"packetVersion must be {VERSION}")
    if packet.get("profile") != PROFILE:
        raise VectorPacketError(f"profile must be {PROFILE}")
    if packet.get("signatureAlgorithm") != "Ed25519" or packet.get("signatureEncoding") != "base64url-no-padding":
        raise VectorPacketError("signature profile must be Ed25519/base64url-no-padding")
    vectors = packet.get("vectors")
    if not isinstance(vectors, list) or not vectors:
        raise VectorPacketError("vectors must be a non-empty array")
    ids: set[str] = set()
    for vector in vectors:
        vector_id = vector.get("vectorId") if isinstance(vector, dict) else None
        if not isinstance(vector_id, str) or not vector_id or vector_id in ids:
            raise VectorPacketError("vector IDs must be present and unique")
        ids.add(vector_id)
    packet["_vectorPacketSha256"] = hashlib.sha256(raw).hexdigest()
    return packet


def valid_hex(value: Any, byte_length: int) -> bool:
    return isinstance(value, str) and len(value) == byte_length * 2 and bool(HEX.fullmatch(value))


def canonical_base64url(value: Any) -> bytes:
    if not isinstance(value, str) or not BASE64URL.fullmatch(value) or len(value) % 4 == 1:
        raise VectorPacketError("signature is not unpadded base64url")
    decoded = base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
    if base64.urlsafe_b64encode(decoded).rstrip(b"=").decode("ascii") != value:
        raise VectorPacketError("signature is not canonical base64url")
    return decoded


def inverse(value: int) -> int:
    return pow(value, Q - 2, Q)


def point_add(left: tuple[int, int], right: tuple[int, int]) -> tuple[int, int]:
    x1, y1 = left
    x2, y2 = right
    product = D * x1 * x2 * y1 * y2 % Q
    return (
        (x1 * y2 + y1 * x2) * inverse(1 + product) % Q,
        (y1 * y2 + x1 * x2) * inverse(1 - product) % Q,
    )


def scalar_multiply(point: tuple[int, int], scalar: int) -> tuple[int, int]:
    result = (0, 1)
    current = point
    while scalar:
        if scalar & 1:
            result = point_add(result, current)
        current = point_add(current, current)
        scalar >>= 1
    return result


def decode_point(encoded: bytes) -> tuple[int, int] | None:
    if len(encoded) != 32:
        return None
    number = int.from_bytes(encoded, "little")
    sign = number >> 255
    y = number & ((1 << 255) - 1)
    if y >= Q:
        return None
    x_squared = (y * y - 1) * inverse(D * y * y + 1) % Q
    x = pow(x_squared, (Q + 3) // 8, Q)
    if x * x % Q != x_squared:
        x = x * SQRT_M1 % Q
    if x * x % Q != x_squared:
        return None
    if x & 1 != sign:
        x = Q - x
    return (x, y)


def verify_ed25519(public_key: bytes, message: bytes, signature: bytes) -> bool:
    if len(public_key) != 32 or len(signature) != 64:
        return False
    encoded_r, encoded_s = signature[:32], signature[32:]
    point_r = decode_point(encoded_r)
    point_a = decode_point(public_key)
    scalar_s = int.from_bytes(encoded_s, "little")
    if point_r is None or point_a is None or scalar_s >= L:
        return False
    scalar_k = int.from_bytes(hashlib.sha512(encoded_r + public_key + message).digest(), "little") % L
    return scalar_multiply(BASE, scalar_s) == point_add(point_r, scalar_multiply(point_a, scalar_k))


def hash_row(vector: dict[str, Any], canonical: str) -> dict[str, Any]:
    actual_hash = digest(canonical)
    matches = canonical == vector.get("expectedCanonical") and actual_hash == vector.get("expectedSha256")
    return {
        "vectorId": vector["vectorId"],
        "kind": vector["kind"],
        "result": "PASS" if matches else "FAIL",
        "canonicalBytesHex": canonical.encode("utf-8").hex(),
        "sha256": actual_hash,
        "signatureValid": None,
        "reason": "" if matches else "hash.mismatch",
    }


def run_vector(vector: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(vector, dict) or not isinstance(vector.get("vectorId"), str) or not isinstance(vector.get("kind"), str):
        raise VectorPacketError("each vector needs vectorId and kind")
    kind = vector["kind"]
    if kind == "canonical-json":
        return hash_row(vector, canonical_json(vector.get("value")))
    if kind == "canonical-float":
        # The float boundary, pinned as data. This runner's default policy is "reject",
        # because a float in a ledger record is meaningless -- but the FI runner
        # normalizes, and that path had no vectors at all, which is how Node and Python
        # drifted to different digests for {"a": 1.0} without a single test going red.
        #
        # Only "normalize" is expressible here, and the reason is worth stating: in
        # JavaScript `1.0` IS `1`, so a Node runner parsing this packet cannot see a
        # float to reject. A "reject" vector would pass in Node for the wrong reason.
        # The reject policy is a Python-side property, tested directly in
        # test/canonical-float-policy.test.mjs where real floats are handed to Python.
        if vector.get("floatPolicy") != "normalize":
            raise VectorPacketError(f"{vector['vectorId']} must declare floatPolicy \"normalize\"")
        return hash_row(vector, _canonical_json(vector.get("value"), float_policy="normalize"))
    if kind == "self-excluding-hash":
        value = vector.get("value")
        fields = vector.get("omitFields")
        if not isinstance(value, dict) or not isinstance(fields, list) or not fields or any(not isinstance(field, str) or not field for field in fields):
            raise VectorPacketError("self-excluding vector needs object value and omitFields")
        unsigned = {key: item for key, item in value.items() if key not in fields}
        return hash_row(vector, canonical_json(unsigned))
    if kind == "chain-hash":
        record_hash, previous_hash, sequence = vector.get("recordHash"), vector.get("prevChainHash"), vector.get("physicalSequence")
        if not valid_hex(record_hash, 32) or not valid_hex(previous_hash, 32) or not isinstance(sequence, int) or isinstance(sequence, bool) or sequence < 1:
            raise VectorPacketError(f"{vector['vectorId']} has invalid chain fields")
        canonical = f"benchmark-ledger-chain-v1\0{record_hash}\0{previous_hash}\0{sequence}"
        return hash_row(vector, canonical)
    if kind == "ed25519":
        valid = False
        try:
            if not valid_hex(vector.get("messageHex"), 32) or not valid_hex(vector.get("publicKeyHex"), 32):
                raise VectorPacketError("message or public key is not fixed-width lowercase hex")
            signature = canonical_base64url(vector.get("signature"))
            valid = len(signature) == 64 and verify_ed25519(bytes.fromhex(vector["publicKeyHex"]), bytes.fromhex(vector["messageHex"]), signature)
        except (ValueError, VectorPacketError):
            valid = False
        observed_reason = "" if valid else "signature.invalid"
        expected_result = vector.get("expectedResult", "PASS")
        expected_reason = vector.get("expectedReason", "")
        matches = (
            expected_result == "FAIL" and not valid and observed_reason == expected_reason
        ) or (
            expected_result == "PASS" and valid and expected_reason == ""
        )
        return {
            "vectorId": vector["vectorId"],
            "kind": kind,
            "result": "PASS" if matches else "FAIL",
            "canonicalBytesHex": vector.get("messageHex"),
            "sha256": None,
            "signatureValid": valid,
            "reason": observed_reason,
        }
    raise VectorPacketError(f"unknown vector kind {kind}")


def run_conformance(packet: dict[str, Any]) -> dict[str, Any]:
    if packet.get("profile") != PROFILE or not isinstance(packet.get("vectors"), list):
        raise VectorPacketError("packet profile or vector list is invalid")
    rows = [run_vector(vector) for vector in packet["vectors"]]
    report = {
        "validatorVersion": VERSION,
        "profile": PROFILE,
        "vectorPacketSha256": packet.get("_vectorPacketSha256"),
        "implementation": {"language": "python", "runtime": sys.version.split()[0]},
        "vectorCount": len(rows),
        "status": "PASS" if all(row["result"] == "PASS" for row in rows) else "FAIL",
        "vectors": rows,
    }
    report["reportSha256"] = digest(canonical_json(report))
    return report


def main(argv: list[str] | None = None) -> int:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(add_help=False, usage="ledger_conformance.py [--vectors <qualification-ledger-vectors.json>] [--json]")
    parser.add_argument("--vectors", default=str(root / "conformance" / "qualification-ledger-vectors.json"))
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--help", action="store_true")
    parsed, unknown = parser.parse_known_args(argv)
    if parsed.help or unknown:
        stream = sys.stdout if parsed.help else sys.stderr
        print(parser.format_usage().strip(), file=stream)
        return 0 if parsed.help else 2
    try:
        report = run_conformance(load_vectors(parsed.vectors))
        if parsed.json:
            write_report(report)
        else:
            print(f"{report['status']} ({report['vectorCount']} vector(s))")
            for row in report["vectors"]:
                suffix = f" ({row['reason']})" if row["reason"] else ""
                print(f"- {row['vectorId']}: {row['result']}{suffix}")
        return 0 if report["status"] == "PASS" else 1
    # ConformanceError and RecursionError also arise AFTER the parse, while canonicalising
    # a vector: a packet deep enough to parse but not to canonicalise (2026-09-28).
    except (OSError, VectorPacketError, ConformanceError, RecursionError) as error:
        report = {"validatorVersion": VERSION, "profile": PROFILE, "vectorCount": 0, "status": "FAIL", "vectors": [], "errors": [{"code": "VECTOR-PACKET", "message": str(error)}]}
        if parsed.json:
            write_report(report)
        else:
            print(f"FAIL: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
