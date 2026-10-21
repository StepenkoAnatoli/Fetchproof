#!/usr/bin/env bash
# pr-readiness.sh - read-only merge readiness check for one GitHub pull request.
#
# Usage: scripts/pr-readiness.sh <pr-number-or-url> [--base <branch>]
#
# Prints the pull request's head SHA and base, one line per condition, then READY or the
# unmet conditions. It reads, never writes. The lead confirms the rest (gate equals baseline
# on the printed head SHA, PR opened by this run, Mandate reply) before merging.
#
# Exit codes (read the code, not the prose):
#   0  READY         every condition gh can see holds
#   1  NOT READY     at least one condition fails; each is printed with "FAIL:"
#   2  UNDETERMINED  a value could not be read; re-run once, then record and stop
#   3  BLOCKED       no gh, not authenticated, not a GitHub repository, or bad arguments
#
# Requires: gh (authenticated), node (any version Fetchproof accepts, 22+).

set -u

# Modified by Fetchproof (ADR-0146): --timeout-minutes, which the parser never accepted, is
# dropped from the usage line, and the kit's rename (ADR-0186, 2026-10-20) changed its name here
# and in the Requires line. The rest is as received from StepenkoAnatoli/SkillsMDs at 3f2d2fc.

PR=""
BASE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --base)
      case "${2-}" in
        ""|-h|--help|--base|--base=*)
          echo "BLOCKED: --base requires a branch" >&2
          exit 3
          ;;
      esac
      if [ $# -lt 2 ]; then
        echo "BLOCKED: --base requires a branch" >&2
        exit 3
      fi
      BASE="$2"
      shift 2
      ;;
    --base=*)
      BASE="${1#--base=}"
      if [ -z "$BASE" ]; then
        echo "BLOCKED: --base requires a branch" >&2
        exit 3
      fi
      shift
      ;;
    -h|--help) sed -n '2,19p' "$0"; exit 3 ;;
    *) if [ -z "$PR" ]; then PR="$1"; shift; else echo "BLOCKED: unexpected argument: $1" >&2; exit 3; fi ;;
  esac
done

if [ -z "$PR" ]; then
  echo "BLOCKED: pull request number or URL required" >&2
  exit 3
fi
if ! command -v gh >/dev/null 2>&1; then
  echo "BLOCKED: gh is not installed; see references/merge-protocol.md section 9" >&2
  exit 3
fi
if ! command -v node >/dev/null 2>&1; then
  echo "BLOCKED: node is required to parse gh output" >&2
  exit 3
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "BLOCKED: gh is not authenticated (gh auth login)" >&2
  exit 3
fi

FIELDS="number,url,state,isDraft,baseRefName,headRefName,headRefOid,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup"
if ! JSON="$(gh pr view "$PR" --json "$FIELDS" 2>&1)"; then
  case "$JSON" in
    *"not a git repository"*|*"no git remotes"*|*"could not determine"*)
      echo "BLOCKED: $JSON" >&2; exit 3 ;;
    *)
      echo "UNDETERMINED: gh pr view failed: $JSON" >&2; exit 2 ;;
  esac
fi

PR_BASE_EXPECTED="$BASE" node - "$JSON" <<'NODE'
const raw = process.argv[2];
const expectedBase = process.env.PR_BASE_EXPECTED || "";
let pr;
try { pr = JSON.parse(raw); } catch (e) { console.error("UNDETERMINED: gh output was not JSON"); process.exit(2); }

const fails = [];
const warns = [];
let undetermined = false;

console.log(`PR #${pr.number} ${pr.url || ""}`);
console.log(`head ${pr.headRefName || "?"} @ ${pr.headRefOid || "?"}`);
console.log(`base ${pr.baseRefName || "?"}`);

// 1. open, not draft
if (pr.state !== "OPEN") fails.push(`state is ${pr.state}, not OPEN`);
if (pr.isDraft === true) fails.push("pull request is a draft");
else if (pr.isDraft === undefined) { undetermined = true; warns.push("draft state not reported"); }

// 2. base branch matches the Mandate
if (expectedBase && pr.baseRefName !== expectedBase) fails.push(`base is ${pr.baseRefName}, Mandate says ${expectedBase}`);

// 3. no conflicts
switch (pr.mergeable) {
  case "MERGEABLE": break;
  case "CONFLICTING": fails.push("conflicts with base (mergeable=CONFLICTING)"); break;
  default: undetermined = true; warns.push(`mergeable is ${pr.mergeable || "unknown"}; GitHub may still be computing it`);
}

// 4. review decision
switch (pr.reviewDecision) {
  case "APPROVED": case "": case null: case undefined: break;
  case "CHANGES_REQUESTED": fails.push("a reviewer requested changes"); break;
  case "REVIEW_REQUIRED": fails.push("branch protection requires a review that has not been given; a person must act"); break;
  default: warns.push(`reviewDecision is ${pr.reviewDecision}`);
}

// 5. checks
const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
const isRequiredReported = checks.some(c => typeof c.isRequired === "boolean");
if (!isRequiredReported && checks.length) warns.push("isRequired not reported by gh; treating every check as required");
let reqFail = 0, reqPending = 0, optFail = 0, pass = 0;
for (const c of checks) {
  const name = c.name || c.context || c.__typename || "check";
  const required = isRequiredReported ? c.isRequired === true : true;
  let verdict;
  if (c.__typename === "StatusContext" || c.state) {
    const s = String(c.state || "").toUpperCase();
    verdict = s === "SUCCESS" ? "pass" : (s === "ERROR" || s === "FAILURE") ? "fail" : "pending";
  } else {
    const st = String(c.status || "").toUpperCase();
    const con = String(c.conclusion || "").toUpperCase();
    if (st !== "COMPLETED") verdict = "pending";
    else if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(con)) verdict = "pass";
    else verdict = "fail";
  }
  if (verdict === "pass") { pass++; continue; }
  const tag = required ? "required" : "optional";
  const detail = c.detailsUrl ? ` ${c.detailsUrl}` : "";
  if (verdict === "fail") {
    if (required) { reqFail++; fails.push(`required check failed: ${name}${detail}`); }
    else { optFail++; warns.push(`optional check failed: ${name}${detail}`); }
  } else {
    if (required) { reqPending++; fails.push(`required check pending: ${name} (${tag})`); }
    else warns.push(`optional check pending: ${name}`);
  }
}
console.log(`checks: ${checks.length} reported, ${pass} passed, ${reqFail} required failed, ${reqPending} required pending, ${optFail} optional failed`);

// 6. merge state as GitHub computes it
switch (pr.mergeStateStatus) {
  case "CLEAN": case "HAS_HOOKS": break;
  case "UNSTABLE":
    if (reqFail || reqPending) fails.push("mergeStateStatus UNSTABLE with required checks not green");
    else warns.push("mergeStateStatus UNSTABLE: only non-required checks are failing");
    break;
  case "BEHIND": fails.push("branch is behind base and protection requires it up to date; rebase per merge-protocol section 2"); break;
  case "BLOCKED": fails.push("mergeStateStatus BLOCKED: a protection rule (review, check, or signing) is unmet"); break;
  case "DIRTY": fails.push("mergeStateStatus DIRTY: conflicts"); break;
  case "DRAFT": fails.push("mergeStateStatus DRAFT"); break;
  default: undetermined = true; warns.push(`mergeStateStatus is ${pr.mergeStateStatus || "unknown"}`);
}

for (const w of warns) console.log(`WARN: ${w}`);
for (const f of fails) console.log(`FAIL: ${f}`);

if (fails.length) { console.log("NOT READY"); process.exit(1); }
if (undetermined) { console.log("UNDETERMINED"); process.exit(2); }
console.log("READY");
console.log("Lead still confirms: gate equals baseline on the head SHA above; PR opened by this run; MANDATE.md reply is GO MERGE.");
process.exit(0);
NODE
