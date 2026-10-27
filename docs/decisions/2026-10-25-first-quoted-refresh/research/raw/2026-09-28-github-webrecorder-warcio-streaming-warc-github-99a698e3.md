---
url: https://github.com/webrecorder/warcio
retrieved: 2026-09-28
command: firecrawl scrape https://github.com/webrecorder/warcio --only-main-content --json
statusCode: 200
transport: firecrawl-cli
completeness: full
title: GitHub - webrecorder/warcio: Streaming WARC/ARC library for fast web archive IO · GitHub
---
[Skip to content](https://github.com/webrecorder/warcio#start-of-content)

You signed in with another tab or window. [Reload](https://github.com/webrecorder/warcio) to refresh your session.You signed out in another tab or window. [Reload](https://github.com/webrecorder/warcio) to refresh your session.You switched accounts on another tab or window. [Reload](https://github.com/webrecorder/warcio) to refresh your session.Dismiss alert

{{ message }}

[webrecorder](https://github.com/webrecorder)/ **[warcio](https://github.com/webrecorder/warcio)** Public

- [Sponsor](https://github.com/sponsors/webrecorder)
- [Notifications](https://github.com/login?return_to=%2Fwebrecorder%2Fwarcio) You must be signed in to change notification settings
- [Fork\\
73](https://github.com/login?return_to=%2Fwebrecorder%2Fwarcio)
- [Star\\
475](https://github.com/login?return_to=%2Fwebrecorder%2Fwarcio)


master

[**11** Branches](https://github.com/webrecorder/warcio/branches) [**4** Tags](https://github.com/webrecorder/warcio/tags)

[Go to Branches page](https://github.com/webrecorder/warcio/branches)[Go to Tags page](https://github.com/webrecorder/warcio/tags)

Go to file

Code

Open more actions menu

## Latest commit

[![tw4l](https://avatars.githubusercontent.com/u/6758804?v=4&size=40)](https://github.com/tw4l)[tw4l](https://github.com/webrecorder/warcio/commits?author=tw4l)

[Update publish\_pypi workflow actions to resolve deprecation and secur…](https://github.com/webrecorder/warcio/commit/2a797aa8c6d67e70966ce9d1a690208ab250fbe7)

Open commit detailssuccess

5 months agoApr 6, 2026

[2a797aa](https://github.com/webrecorder/warcio/commit/2a797aa8c6d67e70966ce9d1a690208ab250fbe7) · 5 months agoApr 6, 2026

## History

[161 Commits](https://github.com/webrecorder/warcio/commits/master/)

Open commit details

[View commit history for this file.](https://github.com/webrecorder/warcio/commits/master/) 161 Commits

## Folders and files

| Name | Name | Last commit message | Last commit date |
| --- | --- | --- | --- |
| [.github/workflows](https://github.com/webrecorder/warcio/tree/master/.github/workflows "This path skips through empty directories") | [.github/workflows](https://github.com/webrecorder/warcio/tree/master/.github/workflows "This path skips through empty directories") | [Update publish\_pypi workflow actions to resolve deprecation and secur…](https://github.com/webrecorder/warcio/commit/2a797aa8c6d67e70966ce9d1a690208ab250fbe7 "Update publish_pypi workflow actions to resolve deprecation and security notices (#198)  * Bump versions of checkout and setup-python actions in publish CI  * Fix version of pypi-publish action  * Modify inaccurate step name - publishes to PyPI, not test") | 5 months agoApr 6, 2026 |
| [test](https://github.com/webrecorder/warcio/tree/master/test "test") | [test](https://github.com/webrecorder/warcio/tree/master/test "test") | [Add open\_or\_default back as alias for fsspec\_open (](https://github.com/webrecorder/warcio/commit/05b1a68d3dda125d12098d0995c0cee920318aa0 "Add open_or_default back as alias for fsspec_open (#197)  * Add open_or_default back as alias for fsspec_open  * Bump version to 1.8.1 and update changelist") [#197](https://github.com/webrecorder/warcio/pull/197) [)](https://github.com/webrecorder/warcio/commit/05b1a68d3dda125d12098d0995c0cee920318aa0 "Add open_or_default back as alias for fsspec_open (#197)  * Add open_or_default back as alias for fsspec_open  * Bump version to 1.8.1 and update changelist") | 6 months agoMar 31, 2026 |
| [warcio](https://github.com/webrecorder/warcio/tree/master/warcio "warcio") | [warcio](https://github.com/webrecorder/warcio/tree/master/warcio "warcio") | [Add open\_or\_default back as alias for fsspec\_open (](https://github.com/webrecorder/warcio/commit/05b1a68d3dda125d12098d0995c0cee920318aa0 "Add open_or_default back as alias for fsspec_open (#197)  * Add open_or_default back as alias for fsspec_open  * Bump version to 1.8.1 and update changelist") [#197](https://github.com/webrecorder/warcio/pull/197) [)](https://github.com/webrecorder/warcio/commit/05b1a68d3dda125d12098d0995c0cee920318aa0 "Add open_or_default back as alias for fsspec_open (#197)  * Add open_or_default back as alias for fsspec_open  * Bump version to 1.8.1 and update changelist") | 6 months agoMar 31, 2026 |
| [.coveragerc](https://github.com/webrecorder/warcio/blob/master/.coveragerc ".coveragerc") | [.coveragerc](https://github.com/webrecorder/warcio/blob/master/.coveragerc ".coveragerc") | [New record HTTP http semantics (](https://github.com/webrecorder/warcio/commit/bb5b22ce6277c4ff279cb06e0fa913f6ce888938 "New record HTTP http semantics (#43)  * add ability to record http traffic to warc directly! Supports:  with (filename_or_warc_writer):     requests.get(...)  - monkey-patch http.client.HTTPConnection (used by requests, etc..) - contextmanager uses warc_writer to write captured data to warc - optional filter callback to skip writing based on request/response - use thread local to support concurrent recording, lock warc writer - tests with requests, using httpbin - add coveragerc with branching - bump version to 1.6.0  - support passing filename directly to record_http, creates WARCWriter automatically - remove record_http from default package init to avoid always monkey-patching - pass warc_writer to filter function  - default record_http() with filename to append=True - if append=False, open in exclusive write, raising if file already exists (don't provide option to overwrite existing WARC to discourage this) - utils: add warcio.utils.open() which supports exclusive open 'x' mode for python 2.7") [#43](https://github.com/webrecorder/warcio/pull/43) [)](https://github.com/webrecorder/warcio/commit/bb5b22ce6277c4ff279cb06e0fa913f6ce888938 "New record HTTP http semantics (#43)  * add ability to record http traffic to warc directly! Supports:  with (filename_or_warc_writer):     requests.get(...)  - monkey-patch http.client.HTTPConnection (used by requests, etc..) - contextmanager uses warc_writer to write captured data to warc - optional filter callback to skip writing based on request/response - use thread local to support concurrent recording, lock warc writer - tests with requests, using httpbin - add coveragerc with branching - bump version to 1.6.0  - support passing filename directly to record_http, creates WARCWriter automatically - remove record_http from default package init to avoid always monkey-patching - pass warc_writer to filter function  - default record_http() with filename to append=True - if append=False, open in exclusive write, raising if file already exists (don't provide option to overwrite existing WARC to discourage this) - utils: add warcio.utils.open() which supports exclusive open 'x' mode for python 2.7") | 8 years agoOct 5, 2018 |
| [.gitattributes](https://github.com/webrecorder/warcio/blob/master/.gitattributes ".gitattributes") | [.gitattributes](https://github.com/webrecorder/warcio/blob/master/.gitattributes ".gitattributes") | [Windows Fixes (](https://github.com/webrecorder/warcio/commit/8e3ceb7995442df3ef884c7667ceaccf8d13bd63 "Windows Fixes (#86)  * binary: ensure .warc, .arc and .gz files are treated as binary  * tests: fix 'unseekable' stream test, on windows, tell() exists but doesn't work, so override (py3) or just use BufferedReader (py2)  * update CHANGELIST for 1.7.1") [#86](https://github.com/webrecorder/warcio/pull/86) [)](https://github.com/webrecorder/warcio/commit/8e3ceb7995442df3ef884c7667ceaccf8d13bd63 "Windows Fixes (#86)  * binary: ensure .warc, .arc and .gz files are treated as binary  * tests: fix 'unseekable' stream test, on windows, tell() exists but doesn't work, so override (py3) or just use BufferedReader (py2)  * update CHANGELIST for 1.7.1") | 7 years agoJul 12, 2019 |
| [.gitignore](https://github.com/webrecorder/warcio/blob/master/.gitignore ".gitignore") | [.gitignore](https://github.com/webrecorder/warcio/blob/master/.gitignore ".gitignore") | [warcio: extract from pywb.warclib -> warcio standalone!](https://github.com/webrecorder/warcio/commit/3da28d2c3d20c3806f2164aa08318f07dcea7acc "warcio: extract from pywb.warclib -> warcio standalone! add test data at test/data setup.py and README.md initial commit") | 9 years agoMar 4, 2017 |
| [CHANGELIST.rst](https://github.com/webrecorder/warcio/blob/master/CHANGELIST.rst "CHANGELIST.rst") | [CHANGELIST.rst](https://github.com/webrecorder/warcio/blob/master/CHANGELIST.rst "CHANGELIST.rst") | [Add open\_or\_default back as alias for fsspec\_open (](https://github.com/webrecorder/warcio/commit/05b1a68d3dda125d12098d0995c0cee920318aa0 "Add open_or_default back as alias for fsspec_open (#197)  * Add open_or_default back as alias for fsspec_open  * Bump version to 1.8.1 and update changelist") [#197](https://github.com/webrecorder/warcio/pull/197) [)](https://github.com/webrecorder/warcio/commit/05b1a68d3dda125d12098d0995c0cee920318aa0 "Add open_or_default back as alias for fsspec_open (#197)  * Add open_or_default back as alias for fsspec_open  * Bump version to 1.8.1 and update changelist") | 6 months agoMar 31, 2026 |
| [CONTRIBUTING.rst](https://github.com/webrecorder/warcio/blob/master/CONTRIBUTING.rst "CONTRIBUTING.rst") | [CONTRIBUTING.rst](https://github.com/webrecorder/warcio/blob/master/CONTRIBUTING.rst "CONTRIBUTING.rst") | [feat: Add s3/https support (](https://github.com/webrecorder/warcio/commit/26a2c1eba523cfdc6e48f3d7b4c3a32d28752523 "feat: Add s3/https support (#194)  * feat: add s3 support to extract and index  * feat: also support http and https  * feat: S3 integration including unit tests  * add new tests and CI to coverage changes  ---------  Co-authored-by: Greg Lindahl <greg@commomncrawl.org> Co-authored-by: malteos <git@i.mieo.de> Co-authored-by: malteos <github@i.mieo.de> Co-authored-by: Tessa Walsh <tessa@bitarchivist.net>") [#194](https://github.com/webrecorder/warcio/pull/194) [)](https://github.com/webrecorder/warcio/commit/26a2c1eba523cfdc6e48f3d7b4c3a32d28752523 "feat: Add s3/https support (#194)  * feat: add s3 support to extract and index  * feat: also support http and https  * feat: S3 integration including unit tests  * add new tests and CI to coverage changes  ---------  Co-authored-by: Greg Lindahl <greg@commomncrawl.org> Co-authored-by: malteos <git@i.mieo.de> Co-authored-by: malteos <github@i.mieo.de> Co-authored-by: Tessa Walsh <tessa@bitarchivist.net>") | 6 months agoMar 23, 2026 |
| [LICENSE](https://github.com/webrecorder/warcio/blob/master/LICENSE "LICENSE") | [LICENSE](https://github.com/webrecorder/warcio/blob/master/LICENSE "LICENSE") | [build prep: update dependencies, add travis and LICENSE](https://github.com/webrecorder/warcio/commit/48680132259356bd56d88fe6093335165468b63f "build prep: update dependencies, add travis and LICENSE") | 9 years agoMar 6, 2017 |
| [MANIFEST.in](https://github.com/webrecorder/warcio/blob/master/MANIFEST.in "MANIFEST.in") | [MANIFEST.in](https://github.com/webrecorder/warcio/blob/master/MANIFEST.in "MANIFEST.in") | [Create MANIFEST.in to include LICENSE (](https://github.com/webrecorder/warcio/commit/bb9a5a08256ac1cf7ff879dd64573cce71437fb2 "Create MANIFEST.in to include LICENSE (#25)") [#25](https://github.com/webrecorder/warcio/pull/25) [)](https://github.com/webrecorder/warcio/commit/bb9a5a08256ac1cf7ff879dd64573cce71437fb2 "Create MANIFEST.in to include LICENSE (#25)") | 9 years agoOct 27, 2017 |
| [NOTICE](https://github.com/webrecorder/warcio/blob/master/NOTICE "NOTICE") | [NOTICE](https://github.com/webrecorder/warcio/blob/master/NOTICE "NOTICE") | [Update NOTICE](https://github.com/webrecorder/warcio/commit/aa702cb321621b233c6e5d2a4780151282a778be "Update NOTICE") | 6 years agoOct 27, 2020 |
| [README.rst](https://github.com/webrecorder/warcio/blob/master/README.rst "README.rst") | [README.rst](https://github.com/webrecorder/warcio/blob/master/README.rst "README.rst") | [feat: Add s3/https support (](https://github.com/webrecorder/warcio/commit/26a2c1eba523cfdc6e48f3d7b4c3a32d28752523 "feat: Add s3/https support (#194)  * feat: add s3 support to extract and index  * feat: also support http and https  * feat: S3 integration including unit tests  * add new tests and CI to coverage changes  ---------  Co-authored-by: Greg Lindahl <greg@commomncrawl.org> Co-authored-by: malteos <git@i.mieo.de> Co-authored-by: malteos <github@i.mieo.de> Co-authored-by: Tessa Walsh <tessa@bitarchivist.net>") [#194](https://github.com/webrecorder/warcio/pull/194) [)](https://github.com/webrecorder/warcio/commit/26a2c1eba523cfdc6e48f3d7b4c3a32d28752523 "feat: Add s3/https support (#194)  * feat: add s3 support to extract and index  * feat: also support http and https  * feat: S3 integration including unit tests  * add new tests and CI to coverage changes  ---------  Co-authored-by: Greg Lindahl <greg@commomncrawl.org> Co-authored-by: malteos <git@i.mieo.de> Co-authored-by: malteos <github@i.mieo.de> Co-authored-by: Tessa Walsh <tessa@bitarchivist.net>") | 6 months agoMar 23, 2026 |
| [appveyor.yml](https://github.com/webrecorder/warcio/blob/master/appveyor.yml "appveyor.yml") | [appveyor.yml](https://github.com/webrecorder/warcio/blob/master/appveyor.yml "appveyor.yml") | [capture\_http/indexer tweaks (](https://github.com/webrecorder/warcio/commit/0c54f445fffea61ecbed15c3c4c59c7a5aedd9d3 "capture_http/indexer tweaks (#116)  * capture_http tweaks: - support record_ip=False option to disable recording ip - support chunked request (via requests) by overriding more lowlevel putrequest() method indexer: support verify_http option passed to Indexer base class update CHANGELIST bump to 1.7.4  * tests fix: use pytest capsys, pin itsdangerous  * ci: drop py27 and py34") [#116](https://github.com/webrecorder/warcio/pull/116) [)](https://github.com/webrecorder/warcio/commit/0c54f445fffea61ecbed15c3c4c59c7a5aedd9d3 "capture_http/indexer tweaks (#116)  * capture_http tweaks: - support record_ip=False option to disable recording ip - support chunked request (via requests) by overriding more lowlevel putrequest() method indexer: support verify_http option passed to Indexer base class update CHANGELIST bump to 1.7.4  * tests fix: use pytest capsys, pin itsdangerous  * ci: drop py27 and py34") | 6 years agoAug 11, 2020 |
| [pytest.ini](https://github.com/webrecorder/warcio/blob/master/pytest.ini "pytest.ini") | [pytest.ini](https://github.com/webrecorder/warcio/blob/master/pytest.ini "pytest.ini") | [fix: Run pytest directly. "setup.py test" was removed in setuptools 7…](https://github.com/webrecorder/warcio/commit/12eca8599ac8fa2ef4ce391c8f203211f7991743 "fix: Run pytest directly. \"setup.py test\" was removed in setuptools 72. (#172)") | 2 years agoAug 21, 2024 |
| [setup.py](https://github.com/webrecorder/warcio/blob/master/setup.py "setup.py") | [setup.py](https://github.com/webrecorder/warcio/blob/master/setup.py "setup.py") | [Add open\_or\_default back as alias for fsspec\_open (](https://github.com/webrecorder/warcio/commit/05b1a68d3dda125d12098d0995c0cee920318aa0 "Add open_or_default back as alias for fsspec_open (#197)  * Add open_or_default back as alias for fsspec_open  * Bump version to 1.8.1 and update changelist") [#197](https://github.com/webrecorder/warcio/pull/197) [)](https://github.com/webrecorder/warcio/commit/05b1a68d3dda125d12098d0995c0cee920318aa0 "Add open_or_default back as alias for fsspec_open (#197)  * Add open_or_default back as alias for fsspec_open  * Bump version to 1.8.1 and update changelist") | 6 months agoMar 31, 2026 |
| View all files |

## Repository files navigation

# WARCIO: WARC (and ARC) Streaming Library

[Permalink: WARCIO: WARC (and ARC) Streaming Library](https://github.com/webrecorder/warcio#warcio-warc-and-arc-streaming-library)

[![https://travis-ci.org/webrecorder/warcio.svg?branch=master](https://camo.githubusercontent.com/f651c04bf02396120a7bb558a6ede52580558693e6e82bc2b9702bfdd2aa345b/68747470733a2f2f7472617669732d63692e6f72672f7765627265636f726465722f77617263696f2e7376673f6272616e63683d6d6173746572)](https://travis-ci.org/webrecorder/warcio)  [![](https://camo.githubusercontent.com/8c4f077a39c0a8fa38c201d49995591d74230c66d71f6d31ecc35520be299c0d/68747470733a2f2f636f6465636f762e696f2f67682f7765627265636f726465722f77617263696f2f6272616e63682f6d61737465722f67726170682f62616467652e737667)](https://codecov.io/gh/webrecorder/warcio)

## Background

[Permalink: Background](https://github.com/webrecorder/warcio#background)

This library provides a fast, standalone way to read and write [WARC\\
Format](https://en.wikipedia.org/wiki/Web_ARChive) commonly used in
web archives. Python 3.7+ (minimally only needing
[six](https://pythonhosted.org/six/) as an external dependency)

warcio supports reading and writing of WARC files compliant with both the [WARC 1.0](http://bibnum.bnf.fr/WARC/WARC_ISO_28500_version1_latestdraft.pdf)
and [WARC 1.1](http://bibnum.bnf.fr/WARC/WARC_ISO_28500_version1-1_latestdraft.pdf) ISO standards.

Install with: `pip install warcio` (or `pip install warcio[all]` to get optional features)

This library is a spin-off of the WARC reading and writing component of
the [pywb](https://github.com/webrecorder/pywb) high-fidelity replay
library, a key component of
[Webrecorder](https://github.com/webrecorder/webrecorder)

The library is designed for fast, low-level access to web archival
content, oriented around a stream of WARC records rather than files.

## Reading WARC Records

[Permalink: Reading WARC Records](https://github.com/webrecorder/warcio#reading-warc-records)

A key feature of the library is to be able to iterate over a stream of
WARC records using the `ArchiveIterator`.

It includes the following features:

- Reading a WARC 1.0, WARC 1.1 or ARC stream
- On the fly ARC to WARC record conversion
- Decompressing and de-chunking HTTP payload content stored in WARC/ARC files.

For example, the following prints the the url for each WARC `response`
record:

```
from warcio.archiveiterator import ArchiveIterator

with open('path/to/file', 'rb') as stream:
    for record in ArchiveIterator(stream):
        if record.rec_type == 'response':
            print(record.rec_headers.get_header('WARC-Target-URI'))
```

The stream object could be a file on disk or a remote network stream.
The `ArchiveIterator` reads the WARC content in a single pass. The
`record` is represented by an `ArcWarcRecord` object which contains
the format (ARC or WARC), record type, the record headers, http headers
(if any), and raw stream for reading the payload.

```
class ArcWarcRecord(object):
    def __init__(self, *args):
        (self.format, self.rec_type, self.rec_headers, self.raw_stream,
         self.http_headers, self.content_type, self.length) = args
```

### Reading WARC Content

[Permalink: Reading WARC Content](https://github.com/webrecorder/warcio#reading-warc-content)

The `raw_stream` can be used to read the rest of the payload directly.
A special `ArcWarcRecord.content_stream()` function provides a stream that
automatically decompresses and de-chunks the HTTP payload, if it is
compressed and/or transfer-encoding chunked.

### ARC Files

[Permalink: ARC Files](https://github.com/webrecorder/warcio#arc-files)

The library provides support for reading (but not writing ARC) files.
The ARC format is legacy but is important to support in a consistent
matter. The `ArchiveIterator` can equally iterate over ARC and WARC
files to emit `ArcWarcRecord` objects. The special `arc2warc` option
converts ARC records to WARCs on the fly, allowing for them to be
accessed using the same API.

(Special `WARCIterator` and `ARCIterator` subclasses of `ArchiveIterator`
are also available to read only WARC or only ARC files).

### WARC and ARC Streaming

[Permalink: WARC and ARC Streaming](https://github.com/webrecorder/warcio#warc-and-arc-streaming)

For example, here is a snippet for reading an ARC and a WARC using the
same API.

The example streams a WARC and ARC file over HTTP using
[requests](http://docs.python-requests.org/en/master/), printing the
`warcinfo` record (or ARC header) and any response records (or all ARC
records) that contain HTML:

```
import requests
from warcio.archiveiterator import ArchiveIterator

def print_records(url):
    resp = requests.get(url, stream=True)

    for record in ArchiveIterator(resp.raw, arc2warc=True):
        if record.rec_type == 'warcinfo':
            print(record.raw_stream.read())

        elif record.rec_type == 'response':
            if record.http_headers.get_header('Content-Type') == 'text/html':
                print(record.rec_headers.get_header('WARC-Target-URI'))
                print(record.content_stream().read())
                print('')

# WARC
print_records('https://archive.org/download/ExampleArcAndWarcFiles/IAH-20080430204825-00000-blackbook.warc.gz')

# ARC with arc2warc
print_records('https://archive.org/download/ExampleArcAndWarcFiles/IAH-20080430204825-00000-blackbook.arc.gz')
```

## Writing WARC Records

[Permalink: Writing WARC Records](https://github.com/webrecorder/warcio#writing-warc-records)

Starting with 1.6, warcio introduces a way to capture HTTP/S traffic directly
to a WARC file, by monkey-patching Python's `http.client` library.

This approach works well with the popular `requests` library often used to fetch
HTTP/S content. Note that `requests` must be imported after the `capture_http` module.

### Quick Start to Writing a WARC

[Permalink: Quick Start to Writing a WARC](https://github.com/webrecorder/warcio#quick-start-to-writing-a-warc)

Fetching the url `https://example.com/` while capturing the response and request
into a gzip compressed WARC file named `example.warc.gz` can be done with the following four lines:

```
from warcio.capture_http import capture_http
import requests  # requests must be imported after capture_http

with capture_http('example.warc.gz'):
    requests.get('https://example.com/')
```

The WARC `example.warc.gz` will contain two records (the response is written first, then the request).

To write to a default in-memory buffer (`BufferWARCWriter`), don't specify a filename, using `with capture_http() as writer:`.

Additional requests in the `capture_http` context and will be appended to the WARC as expected.

The `WARC-IP-Address` header will also be added for each record if the IP address is available.

The following example (similar to a [unit test from the test suite](https://github.com/webrecorder/warcio/blob/master/test/test_capture_http.py)) demonstrates the resulting records created with `capture_http`:

```
with capture_http() as writer:
    requests.get('http://example.com/')
    requests.get('https://google.com/')

expected = [('http://example.com/', 'response', True),\
            ('http://example.com/', 'request', True),\
            ('https://google.com/', 'response', True),\
            ('https://google.com/', 'request', True),\
            ('https://www.google.com/', 'response', True),\
            ('https://www.google.com/', 'request', True)\
           ]

 actual = [\
            (record.rec_headers['WARC-Target-URI'],\
             record.rec_type,\
             'WARC-IP-Address' in record.rec_headers)\
\
            for record in ArchiveIterator(writer.get_stream())\
          ]

 assert actual == expected
```

### Customizing WARC Writing

[Permalink: Customizing WARC Writing](https://github.com/webrecorder/warcio#customizing-warc-writing)

The library provides a simple and extensible interface for writing
standards-compliant WARC files.

The library comes with a basic `WARCWriter` class for writing to a
single WARC file and `BufferWARCWriter` for writing to an in-memory
buffer. The `BaseWARCWriter` can be extended to support more complex
operations.

(There is no support for writing legacy ARC files)

For more flexibility, such as to use a custom `WARCWriter` class,
the above example can be written as:

```
from warcio.capture_http import capture_http
from warcio import WARCWriter
import requests  # requests *must* be imported after capture_http

with open('example.warc.gz', 'wb') as fh:
    warc_writer = WARCWriter(fh)
    with capture_http(warc_writer):
        requests.get('https://example.com/')
```

### WARC/1.1 Support

[Permalink: WARC/1.1 Support](https://github.com/webrecorder/warcio#warc11-support)

By default, warcio creates WARC 1.0 records for maximum compatibility with existing tools.
To create WARC/1.1 records, simply specify the warc version as follows:

```
with capture_http('example.warc.gz', warc_version='1.1'):
    ...
```

```
WARCWriter(fh, warc_version='1.1)
...
```

When using WARC 1.1, the main difference is that the `WARC-Date` timestamp header
will be written with microsecond precision, while WARC 1.0 only supports second precision.

WARC 1.0:

```
WARC/1.0
...
WARC-Date: 2018-12-26T10:11:12Z
```

WARC 1.1:

```
WARC/1.1
...
WARC-Date: 2018-12-26T10:11:12.456789Z
```

### Filtering HTTP Capture

[Permalink: Filtering HTTP Capture](https://github.com/webrecorder/warcio#filtering-http-capture)

When capturing via HTTP, it is possible to provide a custom filter function,
which can be used to determine if a particular request and response records
should be written to the WARC file or skipped.

The filter function is called with the request and response record
before they are written, and can be used to substitute a different record (for example, a revisit
instead of a response), or to skip writing altogether by returning nothing, as shown below:

```
def filter_records(request, response, request_recorder):
    # return None, None to indicate records should be skipped
    if response.http_headers.get_statuscode() != '200':
        return None, None

    # the response record can be replaced with a revisit record
    elif check_for_dedup():
        response = create_revisit_record(...)

    return request, response

with capture_http('example.warc.gz', filter_records):
     requests.get('https://example.com/')
```

Please refer to
[test/test\_capture\_http.py](https://github.com/webrecorder/warcio/blob/master/test/test_capture_http.py) for additional examples
of capturing `requests` traffic to WARC.

### Manual/Advanced WARC Writing

[Permalink: Manual/Advanced WARC Writing](https://github.com/webrecorder/warcio#manualadvanced-warc-writing)

Before 1.6, this was the primary method for fetching a url and then
writing to a WARC. This process is a bit more verbose,
but provides for full control of WARC creation and avoid monkey-patching.

The following example loads `http://example.com/`, creates a WARC
response record, and writes it, gzip compressed, to `example.warc.gz`
The block and payload digests are computed automatically.

```
from warcio.warcwriter import WARCWriter
from warcio.statusandheaders import StatusAndHeaders

import requests

with open('example.warc.gz', 'wb') as output:
    writer = WARCWriter(output, gzip=True)

    resp = requests.get('http://example.com/',
                        headers={'Accept-Encoding': 'identity'},
                        stream=True)

    # get raw headers from urllib3
    headers_list = resp.raw.headers.items()

    http_headers = StatusAndHeaders('200 OK', headers_list, protocol='HTTP/1.0')

    record = writer.create_warc_record('http://example.com/', 'response',
                                        payload=resp.raw,
                                        http_headers=http_headers)

    writer.write_record(record)
```

The library also includes additional semantics for:

> - Creating `warcinfo` and `revisit` records
> - Writing `response` and `request` records together
> - Writing custom WARC records
> - Reading a full WARC record from a stream

Please refer to [warcwriter.py](https://github.com/webrecorder/warcio/blob/master/warcio/warcwriter.py) and
[test/test\_writer.py](https://github.com/webrecorder/warcio/blob/master/test/test_writer.py) for additional examples.

## WARCIO CLI: Indexing and Recompression

[Permalink: WARCIO CLI: Indexing and Recompression](https://github.com/webrecorder/warcio#warcio-cli-indexing-and-recompression)

The library currently ships with a few simple command line tools.

### Index

[Permalink: Index](https://github.com/webrecorder/warcio#index)

The `warcio index` cmd will print a simple index of the records in the
warc file as newline delimited JSON lines (NDJSON).

WARC header fields to include in the index can be specified via the
`-f` flag, and are included in the JSON block (in order, for
convenience).

```
warcio index ./test/data/example-iana.org-chunked.warc -f warc-type,warc-target-uri,content-length
{"warc-type": "warcinfo", "content-length": "137"}
{"warc-type": "response", "warc-target-uri": "http://www.iana.org/", "content-length": "7566"}
{"warc-type": "request", "warc-target-uri": "http://www.iana.org/", "content-length": "76"}
```

HTTP header fields can be included by prefixing them with the prefix
`http:`. The special field `offset` refers to the record offset within
the warc file.

```
warcio index ./test/data/example-iana.org-chunked.warc -f offset,content-type,http:content-type,warc-target-uri
{"offset": "0", "content-type": "application/warc-fields"}
{"offset": "405", "content-type": "application/http;msgtype=response", "http:content-type": "text/html; charset=UTF-8", "warc-target-uri": "http://www.iana.org/"}
{"offset": "8379", "content-type": "application/http;msgtype=request", "warc-target-uri": "http://www.iana.org/"}
```

(Note: this library does not produce CDX or CDXJ format indexes often
associated with web archives. To create these indexes, please see the
[cdxj-indexer](https://github.com/webrecorder/cdxj-indexer) tool which extends warcio indexing to provide this functionality)

### Check

[Permalink: Check](https://github.com/webrecorder/warcio#check)

The `warcio check` command will check the payload and block digests
of WARC records, if possible. An exit value of 1 indicates a failure.
`warcio check -v` will print verbose output for each record in the
WARC file.

### Recompress

[Permalink: Recompress](https://github.com/webrecorder/warcio#recompress)

The `recompress` command allows for re-compressing or normalizing WARC
(or ARC) files to a record-compressed, gzipped WARC file.

Each WARC record is compressed individually and concatenated. This is
the 'canonical' WARC storage format used by
[Webrecorder](https://github.com/webrecorder/webrecorder) and other
web archiving institutions, and usually stored with a `.warc.gz`
extension.

It can be used to: - Compress an uncompressed WARC - Convert any ARC
file to a compressed WARC - Fix an improperly compressed WARC file (eg.
a WARC compressed entirely instead of by record)

```
warcio recompress ./input.arc.gz ./output.warc.gz
```

### Extract

[Permalink: Extract](https://github.com/webrecorder/warcio#extract)

The `extract` command provides a way to extract either the WARC and HTTP headers and/or payload of a WARC record
to stdout. Given a WARC filename and an offset, `extract` will print the (decompressed) record at that offset
in the file to stdout

Specifying --payload or --headers will output only the payload or only the WARC + HTTP headers (if any), respectively.

```
warcio extract [--payload | --headers] filename offset
```

## Remote File System Support

[Permalink: Remote File System Support](https://github.com/webrecorder/warcio#remote-file-system-support)

The library supports reading and writing WARC files to a remote file system such as HTTP or S3.
To enable this feature, you need to install the optional dependencies with `pip install warcio[s3]`.
For example, you can then read WARC files directly from [Common Crawl's S3 bucket](https://commoncrawl.org/get-started).

This command will read a WARC file from outside AWS, using https, and print the first 10 records to stdin:

```
# Note: This command will trigger a broken pipe error after 10 records due to `head -n 10`
warcio index https://data.commoncrawl.org/crawl-data/CC-MAIN-2025-51/segments/1764871645602.73/warc/CC-MAIN-20251215005813-20251215035813-00995.warc.gz | head -n 10
```

This command will read a WARC file from from inside AWS, using S3, and print the first 10 records to stdin:

```
# Note: The bucket is public but reading from S3 requires AWS credentials
warcio index s3://commoncrawl/crawl-data/CC-MAIN-2025-51/segments/1764871645602.73/warc/CC-MAIN-20251215005813-20251215035813-00995.warc.gz | head -n 10
```

This is implemented with [fsspec](https://filesystem-spec.readthedocs.io/en/latest/index.html).
By default, only HTTP, S3, and other built-in fsspec file systems are integrated.
To support other file systems, you need to install the corresponding fsspec dependencies such as `fsspec[gcs]` for Google Cloud storage or `fsspec[all]` for all available file systems.

## Contributing

[Permalink: Contributing](https://github.com/webrecorder/warcio#contributing)

See [CONTRIBUTING.rst](https://github.com/webrecorder/warcio/blob/master/CONTRIBUTING.rst) for guidelines on contributing and running tests.

## License

[Permalink: License](https://github.com/webrecorder/warcio#license)

`warcio` is licensed under the Apache 2.0 License and is part of the
Webrecorder project.

See [NOTICE](https://github.com/webrecorder/warcio/blob/master/NOTICE) and [LICENSE](https://github.com/webrecorder/warcio/blob/master/LICENSE) for details.

## About

Streaming WARC/ARC library for fast web archive IO

[pypi.python.org/pypi/warcio](https://pypi.python.org/pypi/warcio)

### Topics

[python](https://github.com/topics/python) [pywb](https://github.com/topics/pywb) [warc](https://github.com/topics/warc) [web-archives](https://github.com/topics/web-archives) [web-archiving](https://github.com/topics/web-archiving)

### Resources

[Readme](https://github.com/webrecorder/warcio#readme-ov-file)

[Apache-2.0 license](https://github.com/webrecorder/warcio#Apache-2.0-1-ov-file)

### Code of conduct

[Code of conduct](https://github.com/webrecorder/warcio#coc-ov-file)

### Contributing

[Contributing](https://github.com/webrecorder/warcio#contributing-ov-file)

### Security policy

[Security policy](https://github.com/webrecorder/warcio#security-ov-file)

[Activity](https://github.com/webrecorder/warcio/activity)

[Custom properties](https://github.com/webrecorder/warcio/custom-properties)

### Stars

**475** stars

### Watchers

**21** watching

### Forks

[**73** forks](https://github.com/webrecorder/warcio/forks)

[Report repository](https://github.com/contact/report-content?content_url=https%3A%2F%2Fgithub.com%2Fwebrecorder%2Fwarcio&report=webrecorder+%28user%29)

## Releases

## Sponsor this project

## Packages

## Used by

## Contributors

## Languages

You can’t perform that action at this time.
