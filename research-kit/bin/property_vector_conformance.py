#!/usr/bin/env python3
"""Offline Python conformance runner for exported synthetic property vectors."""

from __future__ import annotations

import sys as _sys
from pathlib import Path as _Path
_sys.path.insert(0, str(_Path(__file__).resolve().parent))

import argparse
import copy
import hashlib
import json
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


PROFILE = "researcher-property-vector-v1"
VERSION = "1.0.0"
# computeDescendantInvalidation's package order (lib/release-validator.mjs): R26 to R33, and
# anything else after all of them, as Number.MAX_SAFE_INTEGER. This said R28 to R33 and 999.
PACKAGE_RANK = {f"R{number}": number for number in range(26, 34)}
UNRANKED = 2**53 - 1


class PacketError(ConformanceError):
    """This runner's name for a refused packet. Shared base so the three agree."""


# This runner's float policy, named rather than implied (see conformance_common).
def canonical_json(value):
    return _canonical_json(value, float_policy="reject")


def load_vectors(path: str | Path) -> dict[str, Any]:
    raw = Path(path).read_bytes()
    # read_packet's floor, which this reader does not go through (its profile checks differ).
    if raw.startswith(b"\xef\xbb\xbf"):
        raise PacketError("UTF-8 BOM is not permitted")
    try:
        packet = parse_json_no_duplicates(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, ConformanceError, RecursionError) as error:
        raise PacketError(str(error)) from error
    if not isinstance(packet, dict):
        raise PacketError("packet must be an object")
    if packet.get("packetVersion") != VERSION or packet.get("profile") != PROFILE or packet.get("generatorProfile") != "researcher-property-replay-v1":
        raise PacketError("unsupported packet, profile, or generator profile")
    if not isinstance(packet.get("vectors"), list) or not packet["vectors"] or not isinstance(packet.get("graphs"), dict):
        raise PacketError("vectors and graphs are required")
    ids: set[str] = set()
    for vector in packet["vectors"]:
        vector_id = vector.get("vectorId") if isinstance(vector, dict) else None
        if not isinstance(vector_id, str) or not vector_id or vector_id in ids:
            raise PacketError("vector IDs must be present and unique")
        ids.add(vector_id)
    packet["_vectorPacketSha256"] = hashlib.sha256(raw).hexdigest()
    return packet


def row(vector: dict[str, Any], **fields: Any) -> dict[str, Any]:
    result = {
        "vectorId": vector["vectorId"], "kind": vector["kind"], "result": "FAIL",
        "canonicalBytesHex": None, "sha256": None, "status": None, "primaryReason": None,
        "affectedPointers": [], "revocationRecordIds": [], "reason": "",
    }
    result.update(fields)
    return result


def hash_vector(vector: dict[str, Any]) -> dict[str, Any]:
    canonical = canonical_json(vector.get("value"))
    actual_hash = digest(canonical)
    reordered = digest(canonical_json(vector.get("reorderedValue")))
    matches = (
        canonical == vector.get("expectedCanonical")
        and canonical_json(vector.get("permutedValue")) == canonical
        and actual_hash == vector.get("expectedSha256")
        and reordered == vector.get("expectedReorderedSha256")
        and actual_hash != reordered
    )
    return row(vector, result="PASS" if matches else "FAIL", canonicalBytesHex=canonical.encode("utf-8").hex(), sha256=actual_hash, reason="" if matches else "hash.mismatch")


def record_vector(vector: dict[str, Any]) -> dict[str, Any]:
    value = vector.get("value")
    if not isinstance(value, dict):
        raise PacketError("record-chain vector value must be an object")
    unsigned = {key: item for key, item in value.items() if key not in {"recordHash", "chainHash", "signature"}}
    record_hash = digest(canonical_json(unsigned))
    chain_hash = digest(f"benchmark-ledger-chain-v1\0{record_hash}\0{value.get('prevChainHash')}\0{value.get('physicalSequence')}")
    matches = record_hash == vector.get("expectedRecordHash") and chain_hash == vector.get("expectedChainHash")
    return row(vector, result="PASS" if matches else "FAIL", sha256=record_hash, reason="" if matches else "record-chain.mismatch")


def graph_pointers(packet: dict[str, Any], vector: dict[str, Any]) -> list[dict[str, Any]]:
    source = packet["graphs"].get(vector.get("graphId"))
    if not isinstance(source, list) or not source:
        raise PacketError(f"{vector['vectorId']} names an unknown graph")
    pointers = copy.deepcopy(source)
    mutation = vector.get("mutation")
    if mutation is None:
        return pointers
    if not isinstance(mutation, dict):
        raise PacketError(f"{vector['vectorId']} has an invalid mutation")
    index = next((index for index, pointer in enumerate(pointers) if pointer.get("recordId") == mutation.get("recordId")), -1)
    if index < 0:
        raise PacketError(f"{vector['vectorId']} mutation names an unknown record")
    if mutation.get("kind") == "self-cycle":
        pointers[index]["predecessorHashes"] = [pointers[index]["targetHash"]]
    elif mutation.get("kind") == "duplicate":
        pointers.append(copy.deepcopy(pointers[index]))
    else:
        raise PacketError(f"{vector['vectorId']} has unknown mutation kind")
    return pointers


def graph_failure(reason: str) -> dict[str, Any]:
    return {"status": "FAIL", "primaryReason": reason, "affectedPointers": [], "revocationRecordIds": []}


def js_integer(value: Any) -> bool:
    """`Number.isInteger`: JavaScript has one number type, so `1.0` IS `1` there."""
    return not isinstance(value, bool) and (isinstance(value, int) or (isinstance(value, float) and value.is_integer()))


def js_string(value: Any) -> str:
    """`String(value)`, which is what Node does to each invalidation root."""
    if isinstance(value, str):
        return value
    if value is None or isinstance(value, bool):
        return {None: "null", True: "true", False: "false"}[value]
    if isinstance(value, (int, float)):
        return js_number(value)
    if isinstance(value, list):
        return ",".join("" if item is None else js_string(item) for item in value)
    return "[object Object]"


def graph_outcome(pointers: list[dict[str, Any]], roots: Any) -> dict[str, Any]:
    """`computeDescendantInvalidation` (lib/release-validator.mjs), rule for rule.

    This runner exists to reproduce that primitive independently, and until 2026-10-17 it
    reproduced a different one (#339). It walked reverse predecessor edges from each root,
    so a root naming a pointer's OWN target revoked only its descendants, where Node revokes
    the pointer too; it refused two pointers sharing a targetHash as a duplicate record,
    where Node's identity is (package, generation, recordId) and a target may have several
    owners; it said "descendants.invalidated" for an empty set; and it ranked R26/R27 last.
    The shipped vectors used predecessor-only roots and a full-identity duplicate - the one
    region where both rules agree - so the packet looked like agreement.

    The rule, in Node's order: a malformed pointer is graph.input, a repeated identity
    graph.duplicate-record, a root no target or predecessor names graph.missing-root, and
    a cycle graph.cycle. A pointer's closure is its own targetHash plus the transitive
    predecessor closure through every owner of each hash, and a pointer is revoked when any
    root is in its closure. Node finds a cycle by walking each closure depth-first; that
    finds one exactly when the graph reachable from the targets has one, which is what the
    iterative walk below asks - without Python's recursion limit on a long chain.
    """
    if not isinstance(pointers, list) or not isinstance(roots, list):
        return graph_failure("graph.input")
    identities: set[str] = set()
    owners: dict[str, list[dict[str, Any]]] = {}
    rank: dict[str, int] = {}
    for pointer in pointers:
        if (
            not isinstance(pointer, dict) or not isinstance(pointer.get("recordId"), str)
            or not isinstance(pointer.get("package"), str) or not js_integer(pointer.get("generation"))
            or not isinstance(pointer.get("targetHash"), str) or not isinstance(pointer.get("predecessorHashes"), list)
        ):
            return graph_failure("graph.input")
        identity = f"{pointer['package']}\0{js_number(pointer['generation'])}\0{pointer['recordId']}"
        if identity in identities:
            return graph_failure("graph.duplicate-record")
        identities.add(identity)
        rank[pointer["recordId"]] = PACKAGE_RANK.get(pointer["package"], UNRANKED)
        owners.setdefault(pointer["targetHash"], []).append(pointer)

    # Only a string can equal a root (each is String()-ed) or own a target, so a
    # predecessor of any other type is inert in Node and skipped here.
    def predecessors(value: str) -> list[str]:
        return [hash_ for owner in owners.get(value, []) for hash_ in owner["predecessorHashes"] if isinstance(hash_, str)]

    unique_roots = list(dict.fromkeys(js_string(root) for root in roots))
    known = set(owners).union(*(predecessors(target) for target in owners))
    if any(root not in known for root in unique_roots):
        return graph_failure("graph.missing-root")

    state: dict[str, bool] = {}                      # True while on the walk's path
    for start in owners:
        if start in state:
            continue
        state[start] = True
        stack = [(start, iter(predecessors(start)))]
        while stack:
            value, pending = stack[-1]
            following = next(pending, None)
            if following is None:
                state[value] = False
                stack.pop()
            elif state.get(following):
                return graph_failure("graph.cycle")
            elif following not in state:
                state[following] = True
                stack.append((following, iter(predecessors(following))))

    # Keyed by recordId, as Node's `closures` and `rank` are: the last pointer of a recordId wins.
    closures: dict[str, set[str]] = {}
    for pointer in pointers:
        closure = {pointer["targetHash"]}
        frontier = [pointer["targetHash"]] + [hash_ for hash_ in pointer["predecessorHashes"] if isinstance(hash_, str)]
        while frontier:
            value = frontier.pop()
            closure.add(value)
            frontier.extend(hash_ for hash_ in predecessors(value) if hash_ not in closure)
        closures[pointer["recordId"]] = closure
    affected = [pointer for pointer in pointers if any(root in closures[pointer["recordId"]] for root in unique_roots)]
    # float(): a generation is a double in Node, so 2**53 + 1 sorts as equal to 2**53 there.
    affected.sort(key=lambda pointer: (
        rank[pointer["recordId"]], float(pointer["generation"]), pointer["recordId"].encode("utf-16-be", "surrogatepass"),
    ))
    record_ids = [pointer["recordId"] for pointer in affected]
    reason = "descendants.invalidated" if record_ids else "descendants.none"
    return {"status": "PASS", "primaryReason": reason, "affectedPointers": record_ids, "revocationRecordIds": record_ids}


def graph_vector(packet: dict[str, Any], vector: dict[str, Any]) -> dict[str, Any]:
    outcome = graph_outcome(graph_pointers(packet, vector), vector.get("invalidationRoots", []))
    matches = (
        outcome["status"] == vector.get("expectedStatus")
        and outcome["primaryReason"] == vector.get("expectedPrimaryReason")
        and outcome["affectedPointers"] == vector.get("expectedAffectedPointers")
        and outcome["revocationRecordIds"] == vector.get("expectedRevocationRecordIds")
    )
    return row(vector, result="PASS" if matches else "FAIL", status=outcome["status"], primaryReason=outcome["primaryReason"], affectedPointers=outcome["affectedPointers"], revocationRecordIds=outcome["revocationRecordIds"], reason="" if matches else "graph.mismatch")


def run_conformance(packet: dict[str, Any]) -> dict[str, Any]:
    vectors = []
    for vector in packet["vectors"]:
        if not isinstance(vector, dict) or not isinstance(vector.get("vectorId"), str) or not isinstance(vector.get("kind"), str):
            raise PacketError("each vector needs vectorId and kind")
        if vector["kind"] == "canonical-hash":
            vectors.append(hash_vector(vector))
        elif vector["kind"] == "record-chain":
            vectors.append(record_vector(vector))
        elif vector["kind"] == "graph-invalidation":
            vectors.append(graph_vector(packet, vector))
        else:
            raise PacketError(f"{vector['vectorId']} has unknown vector kind")
    report = {
        "validatorVersion": VERSION, "profile": PROFILE, "vectorPacketSha256": packet["_vectorPacketSha256"],
        "implementation": {"language": "python", "runtime": sys.version.split()[0]}, "vectorCount": len(vectors),
        "status": "PASS" if all(vector["result"] == "PASS" for vector in vectors) else "FAIL", "vectors": vectors,
    }
    report["reportSha256"] = digest(canonical_json(report))
    return report


def main(argv: list[str] | None = None) -> int:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(add_help=False, usage="property_vector_conformance.py [--vectors <property-graph-hash-vectors.json>] [--json]")
    parser.add_argument("--vectors", default=str(root / "conformance" / "property-graph-hash-vectors.json"))
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--help", action="store_true")
    parsed, unknown = parser.parse_known_args(argv)
    if parsed.help or unknown:
        print(parser.format_usage().strip(), file=sys.stdout if parsed.help else sys.stderr)
        return 0 if parsed.help else 2
    try:
        report = run_conformance(load_vectors(parsed.vectors))
        if parsed.json:
            write_report(report)
        else:
            print(f"{report['status']} ({report['vectorCount']} vector(s))")
            for vector in report["vectors"]:
                suffix = f" ({vector['reason']})" if vector["reason"] else ""
                print(f"- {vector['vectorId']}: {vector['result']}{suffix}")
        return 0 if report["status"] == "PASS" else 1
    # ConformanceError and RecursionError also arise AFTER the parse, while canonicalising
    # a vector: a packet deep enough to parse but not to canonicalise (2026-09-28).
    except (OSError, PacketError, ConformanceError, RecursionError) as error:
        report = {"validatorVersion": VERSION, "profile": PROFILE, "vectorCount": 0, "status": "FAIL", "vectors": [], "errors": [{"code": "PROPERTY-VECTOR-PACKET", "message": str(error)}]}
        if parsed.json:
            write_report(report)
        else:
            print(f"FAIL: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
