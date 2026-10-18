"""Shared primitives for the Python conformance runners.

Every runner here answers the same question a Node runner answers, about the same vector
packet, and the answers must match. That only holds if they canonicalise identically --
and until 2026-09-20 they did not.

Three runners each carried their own copy. Two hand-wrote `canonical_json` byte for byte
identically; the third called `json.dumps(sort_keys=True)`, which is a different
algorithm. The divergence was real and provable:

    {"a": 1.0}    Node -> {"a":1}      sha 015abd7f...
                  fi   -> {"a":1.0}    sha c29a44ab...
    {"a": -0.0}   Node -> {"a":0}      sha 45b619e9...
                  fi   -> {"a":-0.0}   sha 952b7dc4...

Cross-language agreement held only because no FI vector contained a float. A suite that
compares 28 chosen inputs does not establish that two functions agree; it establishes
that they agree on 28 inputs.

Standard library only, like the runners it serves.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import sys
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable


class ConformanceError(ValueError):
    """A packet this runner refuses to execute. Runners alias their own name to this.

    Subclasses `ValueError` deliberately, and this is not cosmetic. Every runner's domain
    logic already catches `ValueError` around a single document, because a malformed one
    is a *vector result* -- the FI packet carries a document with a duplicate `fiId` whose
    whole purpose is to be rejected and recorded as FAIL. Raising a bare `Exception` here
    escaped those handlers and turned an expected failure into a crash.
    """


# --------------------------------------------------------------------------- numbers

# JavaScript switches to exponential notation outside this window, and nowhere else.
# These two constants are the ECMAScript Number::toString bounds, not a house style.
_JS_EXPONENTIAL_UPPER = 21
_JS_EXPONENTIAL_LOWER = -6


def js_number(value: float | int) -> str:
    """Format a number exactly as `JSON.stringify` would.

    Python's `repr` is shortest-round-trip, like JavaScript's, so the DIGITS agree. What
    does not agree is everything around them, and each difference is a different hash:

        1.0     Python "1.0"    JavaScript "1"
        -0.0    Python "-0.0"   JavaScript "0"
        1e-7    Python "1e-07"  JavaScript "1e-7"      (Python pads the exponent)
        1e17    Python "1e+17"  JavaScript "100000000000000000"
        1e-5    Python "1e-05"  JavaScript "0.00001"   (different thresholds)

    So this implements ECMAScript's Number::toString directly rather than post-processing
    `repr`, because post-processing is where the fifth case would have been missed.
    """
    if isinstance(value, bool):                      # bool is an int subclass in Python
        raise ConformanceError("boolean is not a number")
    if isinstance(value, int):
        # Outside +/-2**53 JavaScript holds the nearest double, and prints THAT:
        # 9007199254740993 is "9007199254740992" there. canonical_json already rounds so;
        # this did not, and two generations Node calls equal were two here (#339 review).
        if not -(2**53) < value < 2**53:
            try:
                return js_number(float(value))
            except OverflowError:
                raise ConformanceError("non-finite number") from None
        return str(value)
    if value != value or value in (float("inf"), float("-inf")):
        return "null"                                # JSON.stringify(NaN) === "null"
    if value == 0:
        return "0"                                   # and JSON.stringify(-0) === "0"

    sign, digit_tuple, exponent = Decimal(repr(value)).as_tuple()
    digits = "".join(str(d) for d in digit_tuple).rstrip("0") or "0"
    k = len(digits)
    n = len(digit_tuple) + int(exponent)             # the decimal point sits after n digits
    prefix = "-" if sign else ""

    if k <= n <= _JS_EXPONENTIAL_UPPER:
        return prefix + digits + "0" * (n - k)
    if 0 < n <= _JS_EXPONENTIAL_UPPER:
        return prefix + digits[:n] + "." + digits[n:]
    if _JS_EXPONENTIAL_LOWER < n <= 0:
        return prefix + "0." + "0" * (-n) + digits
    mantissa = digits if k == 1 else digits[0] + "." + digits[1:]
    power = n - 1
    return f"{prefix}{mantissa}e{'+' if power >= 0 else '-'}{abs(power)}"


# --------------------------------------------------------------------------- strings

def json_string(value: str) -> str:
    """A JSON string literal, minified, rejecting text that cannot round-trip."""
    if any(0xD800 <= ord(char) <= 0xDFFF for char in value):
        raise ConformanceError("unpaired surrogate is not canonical JSON")
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


# --------------------------------------------------------------------------- canonical

def canonical_json(value: Any, *, float_policy: str = "reject") -> str:
    """Canonical JSON: keys sorted, authored array order, no insignificant whitespace.

    `float_policy` is NAMED rather than implied, because the two policies in this
    repository are both deliberate and were previously indistinguishable from a bug:

      "reject"    a float in a packet is refused. The ledger vectors carry hashes and
                  chain positions, where a float is meaningless and its presence means
                  the packet is wrong. Refusing is more useful than canonicalising.
      "normalize" a float is formatted exactly as JavaScript would. The FI vectors
                  describe documents that may legitimately carry one.

    Keys sort by their UTF-16 code units, not their code points. That is JavaScript's
    string comparison, and it differs from Python's default ordering for anything above
    the BMP -- one of the few places where the obvious Python code is silently wrong.
    """
    if float_policy not in ("reject", "normalize"):
        raise ConformanceError(f"unknown float policy {float_policy!r}")
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return json_string(value)
    if isinstance(value, int):
        # JavaScript has ONE number type, a double. An integer literal outside
        # +/-2**53 does not survive the parse it is about to be hashed after:
        # 9007199254740993 IS 9007199254740992 there, and
        # 123456789012345678901234567890 is 1.2345678901234568e+29. Python's int is
        # arbitrary precision, so `str()` printed the digits the author wrote and the
        # two languages hashed DIFFERENT BYTES for one input - which is the one
        # disagreement this module exists to prevent, one type over.
        #
        # Found 2026-09-28 (Arena break test 12) by differential testing 3,926 generated
        # structures: 107 disagreed, and every one of them was an integer outside the
        # safe range. No shipped vector carried such an integer, which is why the chosen
        # inputs looked like agreement - the same way the float divergence below hid
        # behind vectors that happened to contain no float.
        if not -(2**53) < value < 2**53:
            try:
                return js_number(float(value))
            except OverflowError:
                # Unreachable from a parsed packet (parse_js_integer refuses it first);
                # a value built in code gets the same named refusal, not a traceback.
                raise ConformanceError("non-finite number") from None
        return str(value)
    if isinstance(value, float):
        if float_policy == "reject":
            raise ConformanceError("floating-point values are not accepted by this vector runner")
        return js_number(value)
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item, float_policy=float_policy) for item in value) + "]"
    if isinstance(value, dict):
        # "surrogatepass": an unpaired surrogate in a key must reach json_string, which
        # refuses it by name. The strict codec raised UnicodeEncodeError here first, and the
        # runners printed a traceback instead of a report (2026-09-28). Ordinary keys encode
        # to the same bytes either way.
        keys = sorted(value, key=lambda key: key.encode("utf-16-be", "surrogatepass"))
        return "{" + ",".join(
            f"{json_string(key)}:{canonical_json(value[key], float_policy=float_policy)}" for key in keys
        ) + "}"
    raise ConformanceError(f"unsupported canonical JSON value {type(value).__name__}")


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- parsing

def reject_constant(name: str) -> Any:
    raise ConformanceError(f"{name} is not permitted in a vector packet")


def reject_duplicate_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    """`json.loads` keeps the LAST duplicate key silently; for a hashed packet that is
    the difference between one payload and a different payload with the same digest."""
    seen: dict[str, Any] = {}
    for key, value in pairs:
        if key in seen:
            raise ConformanceError(f"duplicate object key {key!r}")
        seen[key] = value
    return seen


# The deepest nesting a packet may have (ADR-0083); lib/release/json.mjs enforces the same
# number. CPython's canonicaliser recurses and gives out near 300 levels while Node went on
# for thousands, so one packet was a result in one language and a refusal in the other.
MAX_JSON_DEPTH = 256


def json_depth_exceeds(text: str, limit: int = MAX_JSON_DEPTH) -> bool:
    """Whether `text` nests deeper than `limit`, found by a flat scan: `json.loads` is
    itself recursive, so the depth is measured before it runs."""
    depth = 0
    in_string = False
    escaped = False
    for char in text:
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
        elif char in "[{":
            depth += 1
            if depth > limit:
                return True
        elif char in "]}":
            depth -= 1
    return False


def parse_js_integer(digits: str) -> int:
    """An integer literal as JavaScript's reader takes it: one too large for a double is
    Infinity there, and refused as "non-finite number" (lib/release/json.mjs). `int()`
    would accept it, and then `float()` raised OverflowError past ~1.8e308 and `int()`
    itself ValueError past 4300 digits - tracebacks where Node reports (2026-09-28).
    `float()` of the digit string is Infinity, never an error, at any length."""
    if math.isinf(float(digits)):
        raise ConformanceError("non-finite number")
    return int(digits)


def parse_js_float(literal: str) -> float:
    """A fraction or exponent literal as JavaScript's reader takes it: `1e400` is Infinity
    there and refused as "non-finite number". `float()` returns inf without complaint, and
    the inf was then type-checked as a number where Node had refused the parse (#338)."""
    value = float(literal)
    if math.isinf(value):
        raise ConformanceError("non-finite number")
    return value


def parse_json_no_duplicates(text: str) -> Any:
    if json_depth_exceeds(text):
        raise ConformanceError(f"JSON nested deeper than {MAX_JSON_DEPTH} levels")
    return json.loads(
        text, object_pairs_hook=reject_duplicate_pairs, parse_constant=reject_constant, parse_int=parse_js_integer,
        parse_float=parse_js_float,
    )


def read_packet(
    path: str | Path,
    *,
    version: str,
    profile: str,
    error: Callable[[str], Exception] = ConformanceError,
) -> dict[str, Any]:
    """The checks every packet gets before any vector in it runs.

    A packet that drifts is refused whole rather than partly executed. Runners add their
    own further checks; this is the floor, and it is shared so a runner cannot quietly
    have a lower one -- `property_vector_conformance.py` had no BOM check at all, and
    since it still reads its own packet it carries the BOM check itself (2026-09-29).
    """
    raw = Path(path).read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        raise error("UTF-8 BOM is not permitted")
    try:
        packet = parse_json_no_duplicates(raw.decode("utf-8"))
    # RecursionError sits outside JSONDecodeError: a deeply nested packet is a
    # refused packet, not a traceback - the runner's contract is a structured FAIL.
    except (UnicodeDecodeError, json.JSONDecodeError, ConformanceError, RecursionError) as failure:
        raise error(str(failure)) from failure
    if not isinstance(packet, dict):
        raise error("packet must be an object")
    if packet.get("packetVersion") != version:
        raise error(f"packetVersion must be {version}")
    if packet.get("profile") != profile:
        raise error(f"profile must be {profile}")
    return packet


def require_unique_vector_ids(vectors: Any, error: Callable[[str], Exception] = ConformanceError) -> None:
    if not isinstance(vectors, list) or not vectors:
        raise error("vectors must be a non-empty array")
    seen: set[str] = set()
    for vector in vectors:
        vector_id = vector.get("vectorId") if isinstance(vector, dict) else None
        if not isinstance(vector_id, str) or not vector_id or vector_id in seen:
            raise error("vector IDs must be present and unique")
        seen.add(vector_id)


# --------------------------------------------------------------------------- output

_LONE_SURROGATE = re.compile("[\ud800-\udfff]")


def report_json(report: dict[str, Any]) -> str:
    """Two-space indented, trailing newline -- byte-identical to the Node runners.

    A lone surrogate is written as its `\\uXXXX` escape, as JSON.stringify writes it; left
    raw, it could not be encoded to any output at all."""
    text = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    return _LONE_SURROGATE.sub(lambda match: f"\\u{ord(match.group()):04x}", text)


def write_report(report: dict[str, Any]) -> None:
    """The report on stdout as UTF-8 bytes with `\\n` line ends, as Node writes it. Through the
    text layer a Windows pipe took the locale's code page, and a character outside cp1252 raised
    UnicodeEncodeError - a traceback where Node reported - and every line end became CRLF."""
    sys.stdout.flush()
    sys.stdout.buffer.write(report_json(report).encode("utf-8"))
    sys.stdout.flush()
