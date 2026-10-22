# FI PDF visual regression check

**Status:** review-ready, offline, read-only

**Checker:** `fetchproof/bin/check_fi_pdf_visual_regression.py`

Run from the repository root:

```text
python fetchproof/bin/check_fi_pdf_visual_regression.py --json
```

The checker reads the 30-page combined FI packet, the 30 standalone case PDFs,
and the renderer PNGs under `tmp/pdfs/fi-case-pages`. It never writes or
rewrites any artifact. Missing, malformed, or mismatched inputs fail closed with
exit code `1`; a complete pass exits `0`.

## Regression contract

For every FI-01 through FI-30 case, the checker requires:

- exactly one page in each standalone PDF and exactly 30 pages in the combined
  packet;
- an A4 landscape media box (`841.8898 x 595.2756` points), matching CropBox
  when present, with no unexpected rotation;
- exactly one embedded `DeviceRGB` image whose dimensions equal the source PNG;
- decoded embedded image bytes whose SHA-256 exactly equals the source PNG after
  RGB conversion, preserving every visible label, field, checkbox, and
  attestation pixel;
- the assembler's expected centered image transform, with the full draw
  rectangle contained inside page bounds (no clipping or overflow).

The JSON result reports per-case source and embedded hashes, image dimensions,
page bounds, transform values, preservation booleans, PASS/FAIL status, and
explicit errors for both the combined and standalone artifacts. This validates
visual/source-field preservation; it does not validate reviewer-entered values.
