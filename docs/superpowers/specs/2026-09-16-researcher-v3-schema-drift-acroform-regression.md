# SD-0–SD-5 AcroForm regression check

**Status:** review-ready, offline, read-only

**Checker:** `fetchproof/bin/check_sd_acroform_regression.py`

**Inputs:**

- source form: `output/pdf/schema-drift-signoff/SD-0-SD-5-future-schema-drift-signoff.pdf`
- fillable form: `output/pdf/schema-drift-signoff/SD-0-SD-5-future-schema-drift-signoff-acroform.pdf`

Run from the repository root:

```text
python fetchproof/bin/check_sd_acroform_regression.py --json
```

The command never writes either PDF or any sidecar. It exits `0` only when every
check passes; malformed, missing, or unreadable input exits `1` and reports the
failure as JSON (fail closed).

## Regression contract

The source PDF is authoritative. The checker requires:

1. both PDFs to have one landscape-letter page with equal media boxes;
2. the complete extracted text to be byte-for-byte equal, including the seven
   required reviewer attestations and the governing policy attestation;
3. all 64 source-form field names to occur exactly once as AcroForm widgets;
4. every widget rectangle to equal the expected source-cell rectangle within
   `0.01` points (including the four decision checkboxes); and
5. every widget rectangle to remain contained by its source form's input cell.

The JSON result includes the source and fillable paths, checker version, page and
field/widget counts, attestation counts, geometry booleans, status, and a list of
explicit error codes/messages. A `PASS` therefore proves text/attestation and
layout compatibility; it does not assert that any field has been completed.
