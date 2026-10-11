---
url: https://github.com/nodejs/node/blob/v22.22.0/doc/api/fs.md?plain=1
retrieved: 2026-10-07
command: http-keyless scrape https://github.com/nodejs/node/blob/v22.22.0/doc/api/fs.md?plain=1
statusCode: 200
transport: http-keyless
completeness: partial
omitted: 2 sibling section(s) totalling ~49 words were outside the page's main content and are not in this capture
title: node/doc/api/fs.md at v22.22.0 · nodejs/node · GitHub
---
- [nodejs](/nodejs)
- [node](/nodejs/node)





## Repository navigation


-
- [Code](/nodejs/node)
- [Issues603 ( 603 )](/nodejs/node/issues)
- [Pull requests567 ( 567 )](/nodejs/node/pulls)
- [Actions](/nodejs/node/actions)
- [Projects](/nodejs/node/projects)
- [Security and quality](/nodejs/node/security)
- [Insights](/nodejs/node/pulse)



 More items


































## Files Expand file tree

 v22.22.0





## Breadcrumbs


- [node](/nodejs/node/tree/v22.22.0)
- / [doc](/nodejs/node/tree/v22.22.0/doc)
- / [api](/nodejs/node/tree/v22.22.0/doc/api)

 /

# fs.md

 Copy path







 Blame

 More file actions



 Blame

 More file actions





## Latest commit

  





## History

[History](/nodejs/node/commits/v22.22.0/doc/api/fs.md)

 History

 8520 lines (6821 loc) · 264 KB

 v22.22.0





## Breadcrumbs


- [node](/nodejs/node/tree/v22.22.0)
- / [doc](/nodejs/node/tree/v22.22.0/doc)
- / [api](/nodejs/node/tree/v22.22.0/doc/api)

 /

# fs.md

 Copy path

 Top



## File metadata and controls


- Preview
- Code
- Blame



 8520 lines (6821 loc) · 264 KB





 [Raw](https://github.com/nodejs/node/raw/refs/tags/v22.22.0/doc/api/fs.md)

 Copy raw file

 Download raw file



 Open symbols panel Edit and raw actions



 1

 2

 3

 4

 5

 6

 7

 8

 9

 10

 11

 12

 13

 14

 15

 16

 17

 18

 19

 20

 21

 22

 23

 24

 25

 26

 27

 28

 29

 30

 31

 32

 33

 34

 35

 36

 37

 38

 39

 40

 41

 42

 43

 44

 45

 46

 47

 48

 49

 50

 51

 52

 53

 54

 55

 56

 57

 58

 59

 60

 61

 62

 63

 64

 65

 66

 67

 68

 69

 70

 71

 72

 73

 74

 75

 76

 77

 78

 79

 80

 81

 82

 83

 84

 85

 86

 87

 88

 89

 90

 91

 92

 93

 94

 95

 96

 97

 98

 99

 100

 101

 102

 103

 104

 105

 106

 107

 108

 109

 110

 111

 112

 113

 114

 115

 116

 117

 118

 119

 120

 121

 122

 123

 124

 125

 126

 127

 128

 129

 130

 131

 132

 133

 134

 135

 136

 137

 138

 139

 140

 141

 142

 143

 144

 145

 146

 147

 148

 149

 150

 151

 152

 153

 154

 155

 156

 157

 158

 159

 160

 161

 162

 163

 164

 165

 166

 167

 168

 169

 170

 171

 172

 173

 174

 175

 176

 177

 178

 179

 180

 181

 182

 183

 184

 185

 186

 187

 188

 189

 190

 191

 192

 193

 194

 195

 196

 197

 198

 199

 200

 201

 202

 203

 204

 205

 206

 207

 208

 209

 210

 211

 212

 213

 214

 215

 216

 217

 218

 219

 220

 221

 222

 223

 224

 225

 226

 227

 228

 229

 230

 231

 232

 233

 234

 235

 236

 237

 238

 239

 240

 241

 242

 243

 244

 245

 246

 247

 248

 249

 250

 251

 252

 253

 254

 255

 256

 257

 258

 259

 260

 261

 262

 263

 264

 265

 266

 267

 268

 269

 270

 271

 272

 273

 274

 275

 276

 277

 278

 279

 280

 281

 282

 283

 284

 285

 286

 287

 288

 289

 290

 291

 292

 293

 294

 295

 296

 297

 298

 299

 300

 301

 302

 303

 304

 305

 306

 307

 308

 309

 310

 311

 312

 313

 314

 315

 316

 317

 318

 319

 320

 321

 322

 323

 324

 325

 326

 327

 328

 329

 330

 331

 332

 333

 334

 335

 336

 337

 338

 339

 340

 341

 342

 343

 344

 345

 346

 347

 348

 349

 350

 351

 352

 353

 354

 355

 356

 357

 358

 359

 360

 361

 362

 363

 364

 365

 366

 367

 368

 369

 370

 371

 372

 373

 374

 375

 376

 377

 378

 379

 380

 381

 382

 383

 384

 385

 386

 387

 388

 389

 390

 391

 392

 393

 394

 395

 396

 397

 398

 399

 400

 401

 402

 403

 404

 405

 406

 407

 408

 409

 410

 411

 412

 413

 414

 415

 416

 417

 418

 419

 420

 421

 422

 423

 424

 425

 426

 427

 428

 429

 430

 431

 432

 433

 434

 435

 436

 437

 438

 439

 440

 441

 442

 443

 444

 445

 446

 447

 448

 449

 450

 451

 452

 453

 454

 455

 456

 457

 458

 459

 460

 461

 462

 463

 464

 465

 466

 467

 468

 469

 470

 471

 472

 473

 474

 475

 476

 477

 478

 479

 480

 481

 482

 483

 484

 485

 486

 487

 488

 489

 490

 491

 492

 493

 494

 495

 496

 497

 498

 499

 500

 501

 502

 503

 504

 505

 506

 507

 508

 509

 510

 511

 512

 513

 514

 515

 516

 517

 518

 519

 520

 521

 522

 523

 524

 525

 526

 527

 528

 529

 530

 531

 532

 533

 534

 535

 536

 537

 538

 539

 540

 541

 542

 543

 544

 545

 546

 547

 548

 549

 550

 551

 552

 553

 554

 555

 556

 557

 558

 559

 560

 561

 562

 563

 564

 565

 566

 567

 568

 569

 570

 571

 572

 573

 574

 575

 576

 577

 578

 579

 580

 581

 582

 583

 584

 585

 586

 587

 588

 589

 590

 591

 592

 593

 594

 595

 596

 597

 598

 599

 600

 601

 602

 603

 604

 605

 606

 607

 608

 609

 610

 611

 612

 613

 614

 615

 616

 617

 618

 619

 620

 621

 622

 623

 624

 625

 626

 627

 628

 629

 630

 631

 632

 633

 634

 635

 636

 637

 638

 639

 640

 641

 642

 643

 644

 645

 646

 647

 648

 649

 650

 651

 652

 653

 654

 655

 656

 657

 658

 659

 660

 661

 662

 663

 664

 665

 666

 667

 668

 669

 670

 671

 672

 673

 674

 675

 676

 677

 678

 679

 680

 681

 682

 683

 684

 685

 686

 687

 688

 689

 690

 691

 692

 693

 694

 695

 696

 697

 698

 699

 700

 701

 702

 703

 704

 705

 706

 707

 708

 709

 710

 711

 712

 713

 714

 715

 716

 717

 718

 719

 720

 721

 722

 723

 724

 725

 726

 727

 728

 729

 730

 731

 732

 733

 734

 735

 736

 737

 738

 739

 740

 741

 742

 743

 744

 745

 746

 747

 748

 749

 750

 751

 752

 753

 754

 755

 756

 757

 758

 759

 760

 761

 762

 763

 764

 765

 766

 767

 768

 769

 770

 771

 772

 773

 774

 775

 776

 777

 778

 779

 780

 781

 782

 783

 784

 785

 786

 787

 788

 789

 790

 791

 792

 793

 794

 795

 796

 797

 798

 799

 800

 801

 802

 803

 804

 805

 806

 807

 808

 809

 810

 811

 812

 813

 814

 815

 816

 817

 818

 819

 820

 821

 822

 823

 824

 825

 826

 827

 828

 829

 830

 831

 832

 833

 834

 835

 836

 837

 838

 839

 840

 841

 842

 843

 844

 845

 846

 847

 848

 849

 850

 851

 852

 853

 854

 855

 856

 857

 858

 859

 860

 861

 862

 863

 864

 865

 866

 867

 868

 869

 870

 871

 872

 873

 874

 875

 876

 877

 878

 879

 880

 881

 882

 883

 884

 885

 886

 887

 888

 889

 890

 891

 892

 893

 894

 895

 896

 897

 898

 899

 900

 901

 902

 903

 904

 905

 906

 907

 908

 909

 910

 911

 912

 913

 914

 915

 916

 917

 918

 919

 920

 921

 922

 923

 924

 925

 926

 927

 928

 929

 930

 931

 932

 933

 934

 935

 936

 937

 938

 939

 940

 941

 942

 943

 944

 945

 946

 947

 948

 949

 950

 951

 952

 953

 954

 955

 956

 957

 958

 959

 960

 961

 962

 963

 964

 965

 966

 967

 968

 969

 970

 971

 972

 973

 974

 975

 976

 977

 978

 979

 980

 981

 982

 983

 984

 985

 986

 987

 988

 989

 990

 991

 992

 993

 994

 995

 996

 997

 998

 999

 1000

 # File system



 <!--introduced_in=v0.10.0-->



 > Stability: 2 - Stable



 <!--name=fs-->



 <!-- source_link=lib/fs.js -->



 The `node:fs` module enables interacting with the file system in a

 way modeled on standard POSIX functions.



 To use the promise-based APIs:



 ```mjs

 import * as fs from 'node:fs/promises';

 ```



 ```cjs

 const fs = require('node:fs/promises');

 ```



 To use the callback and sync APIs:



 ```mjs

 import * as fs from 'node:fs';

 ```



 ```cjs

 const fs = require('node:fs');

 ```



 All file system operations have synchronous, callback, and promise-based

 forms, and are accessible using both CommonJS syntax and ES6 Modules (ESM).



 ## Promise example



 Promise-based operations return a promise that is fulfilled when the

 asynchronous operation is complete.



 ```mjs

 import { unlink } from 'node:fs/promises';



 try {

 await unlink('/tmp/hello');

 console.log('successfully deleted /tmp/hello');

 } catch (error) {

 console.error('there was an error:', error.message);

 }

 ```



 ```cjs

 const { unlink } = require('node:fs/promises');



 (async function(path) {

 try {

 await unlink(path);

 console.log(`successfully deleted ${path}`);

 } catch (error) {

 console.error('there was an error:', error.message);

 }

 })('/tmp/hello');

 ```



 ## Callback example



 The callback form takes a completion callback function as its last

 argument and invokes the operation asynchronously. The arguments passed to

 the completion callback depend on the method, but the first argument is always

 reserved for an exception. If the operation is completed successfully, then

 the first argument is `null` or `undefined`.



 ```mjs

 import { unlink } from 'node:fs';



 unlink('/tmp/hello', (err) => {

 if (err) throw err;

 console.log('successfully deleted /tmp/hello');

 });

 ```



 ```cjs

 const { unlink } = require('node:fs');



 unlink('/tmp/hello', (err) => {

 if (err) throw err;

 console.log('successfully deleted /tmp/hello');

 });

 ```



 The callback-based versions of the `node:fs` module APIs are preferable over

 the use of the promise APIs when maximal performance (both in terms of

 execution time and memory allocation) is required.



 ## Synchronous example



 The synchronous APIs block the Node.js event loop and further JavaScript

 execution until the operation is complete. Exceptions are thrown immediately

 and can be handled using `try…catch`, or can be allowed to bubble up.



 ```mjs

 import { unlinkSync } from 'node:fs';



 try {

 unlinkSync('/tmp/hello');

 console.log('successfully deleted /tmp/hello');

 } catch (err) {

 // handle the error

 }

 ```



 ```cjs

 const { unlinkSync } = require('node:fs');



 try {

 unlinkSync('/tmp/hello');

 console.log('successfully deleted /tmp/hello');

 } catch (err) {

 // handle the error

 }

 ```



 ## Promises API



 <!-- YAML

 added: v10.0.0

 changes:

 - version: v14.0.0

 pr-url: https://github.com/nodejs/node/pull/31553

 description: Exposed as `require('fs/promises')`.

 - version:

 - v11.14.0

 - v10.17.0

 pr-url: https://github.com/nodejs/node/pull/26581

 description: This API is no longer experimental.

 - version: v10.1.0

 pr-url: https://github.com/nodejs/node/pull/20504

 description: The API is accessible via `require('fs').promises` only.

 -->



 The `fs/promises` API provides asynchronous file system methods that return

 promises.



 The promise APIs use the underlying Node.js threadpool to perform file

 system operations off the event loop thread. These operations are not

 synchronized or threadsafe. Care must be taken when performing multiple

 concurrent modifications on the same file or data corruption may occur.



 ### Class: `FileHandle`



 <!-- YAML

 added: v10.0.0

 -->



 A {FileHandle} object is an object wrapper for a numeric file descriptor.



 Instances of the {FileHandle} object are created by the `fsPromises.open()`

 method.



 All {FileHandle} objects are {EventEmitter}s.



 If a {FileHandle} is not closed using the `filehandle.close()` method, it will

 try to automatically close the file descriptor and emit a process warning,

 helping to prevent memory leaks. Please do not rely on this behavior because

 it can be unreliable and the file may not be closed. Instead, always explicitly

 close {FileHandle}s. Node.js may change this behavior in the future.



 #### Event: `'close'`



 <!-- YAML

 added: v15.4.0

 -->



 The `'close'` event is emitted when the {FileHandle} has been closed and can no

 longer be used.



 #### `filehandle.appendFile(data[, options])`



 <!-- YAML

 added: v10.0.0

 changes:

 - version:

 - v21.1.0

 - v20.10.0

 pr-url: https://github.com/nodejs/node/pull/50095

 description: The `flush` option is now supported.

 - version:

 - v15.14.0

 - v14.18.0

 pr-url: https://github.com/nodejs/node/pull/37490

 description: The `data` argument supports `AsyncIterable`, `Iterable`, and `Stream`.

 - version: v14.0.0

 pr-url: https://github.com/nodejs/node/pull/31030

 description: The `data` parameter won't coerce unsupported input to

 strings anymore.

 -->



 * `data` {string|Buffer|TypedArray|DataView|AsyncIterable|Iterable|Stream}

 * `options` {Object|string}

 * `encoding` {string|null} **Default:** `'utf8'`

 * `signal` {AbortSignal|undefined} allows aborting an in-progress writeFile. **Default:** `undefined`

 * Returns: {Promise} Fulfills with `undefined` upon success.



 Alias of [`filehandle.writeFile()`][].



 When operating on file handles, the mode cannot be changed from what it was set

 to with [`fsPromises.open()`][]. Therefore, this is equivalent to

 [`filehandle.writeFile()`][].



 #### `filehandle.chmod(mode)`



 <!-- YAML

 added: v10.0.0

 -->



 * `mode` {integer} the file mode bit mask.

 * Returns: {Promise} Fulfills with `undefined` upon success.



 Modifies the permissions on the file. See chmod(2).



 #### `filehandle.chown(uid, gid)`



 <!-- YAML

 added: v10.0.0

 -->



 * `uid` {integer} The file's new owner's user id.

 * `gid` {integer} The file's new group's group id.

 * Returns: {Promise} Fulfills with `undefined` upon success.



 Changes the ownership of the file. A wrapper for chown(2).



 #### `filehandle.close()`



 <!-- YAML

 added: v10.0.0

 -->



 * Returns: {Promise} Fulfills with `undefined` upon success.



 Closes the file handle after waiting for any pending operation on the handle to

 complete.



 ```mjs

 import { open } from 'node:fs/promises';



 let filehandle;

 try {

 filehandle = await open('thefile.txt', 'r');

 } finally {

 await filehandle?.close();

 }

 ```



 #### `filehandle.createReadStream([options])`



 <!-- YAML

 added: v16.11.0

 -->



 * `options` {Object}

 * `encoding` {string} **Default:** `null`

 * `autoClose` {boolean} **Default:** `true`

 * `emitClose` {boolean} **Default:** `true`

 * `start` {integer}

 * `end` {integer} **Default:** `Infinity`

 * `highWaterMark` {integer} **Default:** `64 * 1024`

 * `signal` {AbortSignal|undefined} **Default:** `undefined`

 * Returns: {fs.ReadStream}



 `options` can include `start` and `end` values to read a range of bytes from

 the file instead of the entire file. Both `start` and `end` are inclusive and

 start counting at 0, allowed values are in the

 \[0, [`Number.MAX_SAFE_INTEGER`][]] range. If `start` is

 omitted or `undefined`, `filehandle.createReadStream()` reads sequentially from

 the current file position. The `encoding` can be any one of those accepted by

 {Buffer}.



 If the `FileHandle` points to a character device that only supports blocking

 reads (such as keyboard or sound card), read operations do not finish until data

 is available. This can prevent the process from exiting and the stream from

 closing naturally.



 By default, the stream will emit a `'close'` event after it has been

 destroyed. Set the `emitClose` option to `false` to change this behavior.



 ```mjs

 import { open } from 'node:fs/promises';



 const fd = await open('/dev/input/event0');

 // Create a stream from some character device.

 const stream = fd.createReadStream();

 setTimeout(() => {

 stream.close(); // This may not close the stream.

 // Artificially marking end-of-stream, as if the underlying resource had

 // indicated end-of-file by itself, allows the stream to close.

 // This does not cancel pending read operations, and if there is such an

 // operation, the process may still not be able to exit successfully

 // until it finishes.

 stream.push(null);

 stream.read(0);

 }, 100);

 ```



 If `autoClose` is false, then the file descriptor won't be closed, even if

 there's an error. It is the application's responsibility to close it and make

 sure there's no file descriptor leak. If `autoClose` is set to true (default

 behavior), on `'error'` or `'end'` the file descriptor will be closed

 automatically.



 An example to read the last 10 bytes of a file which is 100 bytes long:



 ```mjs

 import { open } from 'node:fs/promises';



 const fd = await open('sample.txt');

 fd.createReadStream({ start: 90, end: 99 });

 ```



 #### `filehandle.createWriteStream([options])`



 <!-- YAML

 added: v16.11.0

 changes:

 - version:

 - v21.0.0

 - v20.10.0

 pr-url: https://github.com/nodejs/node/pull/50093

 description: The `flush` option is now supported.

 -->



 * `options` {Object}

 * `encoding` {string} **Default:** `'utf8'`

 * `autoClose` {boolean} **Default:** `true`

 * `emitClose` {boolean} **Default:** `true`

 * `start` {integer}

 * `highWaterMark` {number} **Default:** `16384`

 * `flush` {boolean} If `true`, the underlying file descriptor is flushed

 prior to closing it. **Default:** `false`.

 * Returns: {fs.WriteStream}



 `options` may also include a `start` option to allow writing data at some

 position past the beginning of the file, allowed values are in the

 \[0, [`Number.MAX_SAFE_INTEGER`][]] range. Modifying a file rather than

 replacing it may require the `flags` `open` option to be set to `r+` rather than

 the default `r`. The `encoding` can be any one of those accepted by {Buffer}.



 If `autoClose` is set to true (default behavior) on `'error'` or `'finish'`

 the file descriptor will be closed automatically. If `autoClose` is false,

 then the file descriptor won't be closed, even if there's an error.

 It is the application's responsibility to close it and make sure there's no

 file descriptor leak.



 By default, the stream will emit a `'close'` event after it has been

 destroyed. Set the `emitClose` option to `false` to change this behavior.



 #### `filehandle.datasync()`



 <!-- YAML

 added: v10.0.0

 -->



 * Returns: {Promise} Fulfills with `undefined` upon success.



 Forces all currently queued I/O operations associated with the file to the

 operating system's synchronized I/O completion state. Refer to the POSIX

 fdatasync(2) documentation for details.



 Unlike `filehandle.sync` this method does not flush modified metadata.



 #### `filehandle.fd`



 <!-- YAML

 added: v10.0.0

 -->



 * Type: {number} The numeric file descriptor managed by the {FileHandle} object.



 #### `filehandle.read(buffer, offset, length, position)`



 <!-- YAML

 added: v10.0.0

 changes:

 - version: v21.0.0

 pr-url: https://github.com/nodejs/node/pull/42835

 description: Accepts bigint values as `position`.

 -->



 * `buffer` {Buffer|TypedArray|DataView} A buffer that will be filled with the

 file data read.

 * `offset` {integer} The location in the buffer at which to start filling.

 **Default:** `0`

 * `length` {integer} The number of bytes to read. **Default:**

 `buffer.byteLength - offset`

 * `position` {integer|bigint|null} The location where to begin reading data

 from the file. If `null` or `-1`, data will be read from the current file

 position, and the position will be updated. If `position` is a non-negative

 integer, the current file position will remain unchanged.

 **Default:** `null`

 * Returns: {Promise} Fulfills upon success with an object with two properties:

 * `bytesRead` {integer} The number of bytes read

 * `buffer` {Buffer|TypedArray|DataView} A reference to the passed in `buffer`

 argument.



 Reads data from the file and stores that in the given buffer.



 If the file is not modified concurrently, the end-of-file is reached when the

 number of bytes read is zero.



 #### `filehandle.read([options])`



 <!-- YAML

 added:

 - v13.11.0

 - v12.17.0

 changes:

 - version: v21.0.0

 pr-url: https://github.com/nodejs/node/pull/42835

 description: Accepts bigint values as `position`.

 -->



 * `options` {Object}

 * `buffer` {Buffer|TypedArray|DataView} A buffer that will be filled with the

 file data read. **Default:** `Buffer.alloc(16384)`

 * `offset` {integer} The location in the buffer at which to start filling.

 **Default:** `0`

 * `length` {integer} The number of bytes to read. **Default:**

 `buffer.byteLength - offset`

 * `position` {integer|bigint|null} The location where to begin reading data

 from the file. If `null` or `-1`, data will be read from the current file

 position, and the position will be updated. If `position` is a non-negative

 integer, the current file position will remain unchanged.

 **Default:**: `null`

 * Returns: {Promise} Fulfills upon success with an object with two properties:

 * `bytesRead` {integer} The number of bytes read

 * `buffer` {Buffer|TypedArray|DataView} A reference to the passed in `buffer`

 argument.



 Reads data from the file and stores that in the given buffer.



 If the file is not modified concurrently, the end-of-file is reached when the

 number of bytes read is zero.



 #### `filehandle.read(buffer[, options])`



 <!-- YAML

 added:

 - v18.2.0

 - v16.17.0

 changes:

 - version: v21.0.0

 pr-url: https://github.com/nodejs/node/pull/42835

 description: Accepts bigint values as `position`.

 -->



 * `buffer` {Buffer|TypedArray|DataView} A buffer that will be filled with the

 file data read.

 * `options` {Object}

 * `offset` {integer} The location in the buffer at which to start filling.

 **Default:** `0`

 * `length` {integer} The number of bytes to read. **Default:**

 `buffer.byteLength - offset`

 * `position` {integer|bigint|null} The location where to begin reading data

 from the file. If `null` or `-1`, data will be read from the current file

 position, and the position will be updated. If `position` is a non-negative

 integer, the current file position will remain unchanged.

 **Default:**: `null`

 * Returns: {Promise} Fulfills upon success with an object with two properties:

 * `bytesRead` {integer} The number of bytes read

 * `buffer` {Buffer|TypedArray|DataView} A reference to the passed in `buffer`

 argument.



 Reads data from the file and stores that in the given buffer.



 If the file is not modified concurrently, the end-of-file is reached when the

 number of bytes read is zero.



 #### `filehandle.readableWebStream([options])`



 <!-- YAML

 added: v17.0.0

 changes:

 - version: v22.17.0

 pr-url: https://github.com/nodejs/node/pull/57513

 description: Marking the API stable.

 - version: v22.17.0

 pr-url: https://github.com/nodejs/node/pull/58548

 description: Added the `autoClose` option.

 - version: v22.15.0

 pr-url: https://github.com/nodejs/node/pull/55461

 description: Removed option to create a 'bytes' stream. Streams are now always 'bytes' streams.

 - version:

 - v20.0.0

 - v18.17.0

 pr-url: https://github.com/nodejs/node/pull/46933

 description: Added option to create a 'bytes' stream.

 -->



 * `options` {Object}

 * `autoClose` {boolean} When true, causes the {FileHandle} to be closed when the

 stream is closed. **Default:** `false`

 * Returns: {ReadableStream}



 Returns a byte-oriented `ReadableStream` that may be used to read the file's

 contents.



 An error will be thrown if this method is called more than once or is called

 after the `FileHandle` is closed or closing.



 ```mjs

 import {

 open,

 } from 'node:fs/promises';



 const file = await open('./some/file/to/read');



 for await (const chunk of file.readableWebStream())

 console.log(chunk);



 await file.close();

 ```



 ```cjs

 const {

 open,

 } = require('node:fs/promises');



 (async () => {

 const file = await open('./some/file/to/read');



 for await (const chunk of file.readableWebStream())

 console.log(chunk);



 await file.close();

 })();

 ```



 While the `ReadableStream` will read the file to completion, it will not

 close the `FileHandle` automatically. User code must still call the

 `fileHandle.close()` method.



 #### `filehandle.readFile(options)`



 <!-- YAML

 added: v10.0.0

 -->



 * `options` {Object|string}

 * `encoding` {string|null} **Default:** `null`

 * `signal` {AbortSignal} allows aborting an in-progress readFile

 * Returns: {Promise} Fulfills upon a successful read with the contents of the

 file. If no encoding is specified (using `options.encoding`), the data is

 returned as a {Buffer} object. Otherwise, the data will be a string.



 Asynchronously reads the entire contents of a file.



 If `options` is a string, then it specifies the `encoding`.



 The {FileHandle} has to support reading.



 If one or more `filehandle.read()` calls are made on a file handle and then a

 `filehandle.readFile()` call is made, the data will be read from the current

 position till the end of the file. It doesn't always read from the beginning

 of the file.



 #### `filehandle.readLines([options])`



 <!-- YAML

 added: v18.11.0

 -->



 * `options` {Object}

 * `encoding` {string} **Default:** `null`

 * `autoClose` {boolean} **Default:** `true`

 * `emitClose` {boolean} **Default:** `true`

 * `start` {integer}

 * `end` {integer} **Default:** `Infinity`

 * `highWaterMark` {integer} **Default:** `64 * 1024`

 * Returns: {readline.InterfaceConstructor}



 Convenience method to create a `readline` interface and stream over the file.

 See [`filehandle.createReadStream()`][] for the options.



 ```mjs

 import { open } from 'node:fs/promises';



 const file = await open('./some/file/to/read');



 for await (const line of file.readLines()) {

 console.log(line);

 }

 ```



 ```cjs

 const { open } = require('node:fs/promises');



 (async () => {

 const file = await open('./some/file/to/read');



 for await (const line of file.readLines()) {

 console.log(line);

 }

 })();

 ```



 #### `filehandle.readv(buffers[, position])`



 <!-- YAML

 added:

 - v13.13.0

 - v12.17.0

 -->



 * `buffers` {Buffer\[]|TypedArray\[]|DataView\[]}

 * `position` {integer|null} The offset from the beginning of the file where

 the data should be read from. If `position` is not a `number`, the data will

 be read from the current position. **Default:** `null`

 * Returns: {Promise} Fulfills upon success an object containing two properties:

 * `bytesRead` {integer} the number of bytes read

 * `buffers` {Buffer\[]|TypedArray\[]|DataView\[]} property containing

 a reference to the `buffers` input.



 Read from a file and write to an array of {ArrayBufferView}s



 #### `filehandle.stat([options])`



 <!-- YAML

 added: v10.0.0

 changes:

 - version: v10.5.0

 pr-url: https://github.com/nodejs/node/pull/20220

 description: Accepts an additional `options` object to specify whether

 the numeric values returned should be bigint.

 -->



 * `options` {Object}

 * `bigint` {boolean} Whether the numeric values in the returned

 {fs.Stats} object should be `bigint`. **Default:** `false`.

 * Returns: {Promise} Fulfills with an {fs.Stats} for the file.



 #### `filehandle.sync()`



 <!-- YAML

 added: v10.0.0

 -->



 * Returns: {Promise} Fulfills with `undefined` upon success.



 Request that all data for the open file descriptor is flushed to the storage

 device. The specific implementation is operating system and device specific.

 Refer to the POSIX fsync(2) documentation for more detail.



 #### `filehandle.truncate(len)`



 <!-- YAML

 added: v10.0.0

 -->



 * `len` {integer} **Default:** `0`

 * Returns: {Promise} Fulfills with `undefined` upon success.



 Truncates the file.



 If the file was larger than `len` bytes, only the first `len` bytes will be

 retained in the file.



 The following example retains only the first four bytes of the file:



 ```mjs

 import { open } from 'node:fs/promises';



 let filehandle = null;

 try {

 filehandle = await open('temp.txt', 'r+');

 await filehandle.truncate(4);

 } finally {

 await filehandle?.close();

 }

 ```



 If the file previously was shorter than `len` bytes, it is extended, and the

 extended part is filled with null bytes (`'\0'`):



 If `len` is negative then `0` will be used.



 #### `filehandle.utimes(atime, mtime)`



 <!-- YAML

 added: v10.0.0

 -->



 * `atime` {number|string|Date}

 * `mtime` {number|string|Date}

 * Returns: {Promise}



 Change the file system timestamps of the object referenced by the {FileHandle}

 then fulfills the promise with no arguments upon success.



 #### `filehandle.write(buffer, offset[, length[, position]])`



 <!-- YAML

 added: v10.0.0

 changes:

 - version: v14.0.0

 pr-url: https://github.com/nodejs/node/pull/31030

 description: The `buffer` parameter won't coerce unsupported input to

 buffers anymore.

 -->



 * `buffer` {Buffer|TypedArray|DataView}

 * `offset` {integer} The start position from within `buffer` where the data

 to write begins.

 * `length` {integer} The number of bytes from `buffer` to write. **Default:**

 `buffer.byteLength - offset`

 * `position` {integer|null} The offset from the beginning of the file where the

 data from `buffer` should be written. If `position` is not a `number`,

 the data will be written at the current position. See the POSIX pwrite(2)

 documentation for more detail. **Default:** `null`

 * Returns: {Promise}



 Write `buffer` to the file.



 The promise is fulfilled with an object containing two properties:



 * `bytesWritten` {integer} the number of bytes written

 * `buffer` {Buffer|TypedArray|DataView} a reference to the

 `buffer` written.



 It is unsafe to use `filehandle.write()` multiple times on the same file

 without waiting for the promise to be fulfilled (or rejected). For this

 scenario, use [`filehandle.createWriteStream()`][].



 On Linux, positional writes do not work when the file is opened in append mode.

 The kernel ignores the position argument and always appends the data to

 the end of the file.



 #### `filehandle.write(buffer[, options])`



 <!-- YAML

 added:

 - v18.3.0

 - v16.17.0

 -->



 * `buffer` {Buffer|TypedArray|DataView}

 * `options` {Object}

 * `offset` {integer} **Default:** `0`

 * `length` {integer} **Default:** `buffer.byteLength - offset`

 * `position` {integer|null} **Default:** `null`

 * Returns: {Promise}



 Write `buffer` to the file.



 Similar to the above `filehandle.write` function, this version takes an

 optional `options` object. If no `options` object is specified, it will

 default with the above values.



 #### `filehandle.write(string[, position[, encoding]])`



 <!-- YAML

 added: v10.0.0

 changes:

 - version: v14.0.0

 pr-url: https://github.com/nodejs/node/pull/31030

 description: The `string` parameter won't coerce unsupported input to

 strings anymore.

 -->



 * `string` {string}

 * `position` {integer|null} The offset from the beginning of the file where the

 data from `string` should be written. If `position` is not a `number` the

 data will be written at the current position. See the POSIX pwrite(2)

 documentation for more detail. **Default:** `null`

 * `encoding` {string} The expected string encoding. **Default:** `'utf8'`

 * Returns: {Promise}



 Write `string` to the file. If `string` is not a string, the promise is

 rejected with an error.



 The promise is fulfilled with an object containing two properties:



 * `bytesWritten` {integer} the number of bytes written

 * `buffer` {string} a reference to the `string` written.



 It is unsafe to use `filehandle.write()` multiple times on the same file

 without waiting for the promise to be fulfilled (or rejected). For this

 scenario, use [`filehandle.createWriteStream()`][].



 On Linux, positional writes do not work when the file is opened in append mode.

 The kernel ignores the position argument and always appends the data to

 the end of the file.



 #### `filehandle.writeFile(data, options)`



 <!-- YAML

 added: v10.0.0

 changes:

 - version:

 - v15.14.0

 - v14.18.0

 pr-url: https://github.com/nodejs/node/pull/37490

 description: The `data` argument supports `AsyncIterable`, `Iterable`, and `Stream`.

 - version: v14.0.0

 pr-url: https://github.com/nodejs/node/pull/31030

 description: The `data` parameter won't coerce unsupported input to

 strings anymore.

 -->



 * `data` {string|Buffer|TypedArray|DataView|AsyncIterable|Iterable|Stream}

 * `options` {Object|string}

 * `encoding` {string|null} The expected character encoding when `data` is a

 string. **Default:** `'utf8'`

 * `signal` {AbortSignal|undefined} allows aborting an in-progress writeFile. **Default:** `undefined`

 * Returns: {Promise}



 Asynchronously writes data to a file, replacing the file if it already exists.

 `data` can be a string, a buffer, an {AsyncIterable}, or an {Iterable} object.

 The promise is fulfilled with no arguments upon success.



 If `options` is a string, then it specifies the `encoding`.



 The {FileHandle} has to support writing.



 It is unsafe to use `filehandle.writeFile()` multiple times on the same file

 without waiting for the promise to be fulfilled (or rejected).



 If one or more `filehandle.write()` calls are made on a file handle and then a

 `filehandle.writeFile()` call is made, the data will be written from the

 current position till the end of the file. It doesn't always write from the

 beginning of the file.



 #### `filehandle.writev(buffers[, position])`



 <!-- YAML

 added: v12.9.0

 -->



 * `buffers` {Buffer\[]|TypedArray\[]|DataView\[]}

 * `position` {integer|null} The offset from the beginning of the file where the

 data from `buffers` should be written. If `position` is not a `number`,

 the data will be written at the current position. **Default:** `null`

 * Returns: {Promise}



 Write an array of {ArrayBufferView}s to the file.



 The promise is fulfilled with an object containing a two properties:



 * `bytesWritten` {integer} the number of bytes written

 * `buffers` {Buffer\[]|TypedArray\[]|DataView\[]} a reference to the `buffers`

 input.



 It is unsafe to call `writev()` multiple times on the same file without waiting

 for the promise to be fulfilled (or rejected).



 On Linux, positional writes don't work when the file is opened in append mode.

 The kernel ignores the position argument and always appends the data to

 the end of the file.



 #### `filehandle[Symbol.asyncDispose]()`



 <!-- YAML

 added:

 - v20.4.0

 - v18.18.0

 -->



 > Stability: 1 - Experimental



 Calls `filehandle.close()` and returns a promise that fulfills when the

 filehandle is closed.



 ### `fsPromises.access(path[, mode])`



 <!-- YAML

 added: v10.0.0

 -->



 * `path` {string|Buffer|URL}

 * `mode` {integer} **Default:** `fs.constants.F_OK`

 * Returns: {Promise} Fulfills with `undefined` upon success.



 Tests a user's permissions for the file or directory specified by `path`.

 The `mode` argument is an optional integer that specifies the accessibility

 checks to be performed. `mode` should be either the value `fs.constants.F_OK`

 or a mask consisting of the bitwise OR of any of `fs.constants.R_OK`,

 `fs.constants.W_OK`, and `fs.constants.X_OK` (e.g.

 `fs.constants.W_OK | fs.constants.R_OK`). Check [File access constants][] for

 possible values of `mode`.



 If the accessibility check is successful, the promise is fulfilled with no

 value. If any of the accessibility checks fail, the promise is rejected

 with an {Error} object. The following example checks if the file

 `/etc/passwd` can be read and written by the current process.



 ```mjs

 import { access, constants } from 'node:fs/promises';



 try {

 await access('/etc/passwd', constants.R_OK | constants.W_OK);

 console.log('can access');

 } catch {

 console.error('cannot access');

 }

 ```



 Using `fsPromises.access()` to check for the accessibility of a file before

 calling `fsPromises.open()` is not recommended. Doing so introduces a race

 condition, since other processes may change the file's state between the two

 calls. Instead, user code should open/read/write the file directly and handle

 the error raised if the file is not accessible.



 ### `fsPromises.appendFile(path, data[, options])`



 <!-- YAML

 added: v10.0.0

 changes:

 - version:

 - v21.1.0

 - v20.10.0

 pr-url: https://github.com/nodejs/node/pull/50095

 description: The `flush` option is now supported.

 -->



 * `path` {string|Buffer|URL|FileHandle} filename or {FileHandle}

 * `data` {string|Buffer}

 * `options` {Object|string}

 * `encoding` {string|null} **Default:** `'utf8'`

 * `mode` {integer} **Default:** `0o666`

 * `flag` {string} See [support of file system `flags`][]. **Default:** `'a'`.

 * `flush` {boolean} If `true`, the underlying file descriptor is flushed

 prior to closing it. **Default:** `false`.

 * Returns: {Promise} Fulfills with `undefined` upon success.



 Asynchronously append data to a file, creating the file if it does not yet

 exist. `data` can be a string or a {Buffer}.



 If `options` is a string, then it specifies the `encoding`.



 The `mode` option only affects the newly created file. See [`fs.open()`][]

 for more details.



 The `path` may be specified as a {FileHandle} that has been opened

 for appending (using `fsPromises.open()`).



 ### `fsPromises.chmod(path, mode)`



 <!-- YAML

 added: v10.0.0

 -->



 * `path` {string|Buffer|URL}

 * `mode` {string|integer}

 * Returns: {Promise} Fulfills with `undefined` upon success.



 Changes the permissions of a file.



 ### `fsPromises.chown(path, uid, gid)`



 <!-- YAML

 added: v10.0.0

 -->



 * `path` {string|Buffer|URL}

 * `uid` {integer}

 * `gid` {integer}

 * Returns: {Promise} Fulfills with `undefined` upon success.



 Changes the ownership of a file.



 ### `fsPromises.copyFile(src, dest[, mode])`



 <!-- YAML

 added: v10.0.0

 changes:

 - version: v14.0.0

 pr-url: https://github.com/nodejs/node/pull/27044

 description: Changed `flags` argument to `mode` and imposed

 stricter type validation.

 -->



 * `src` {string|Buffer|URL} source filename to copy

 * `dest` {string|Buffer|URL} destination filename of the copy operation

 * `mode` {integer} Optional modifiers that specify the behavior of the copy

 operation. It is possible to create a mask consisting of the bitwise OR of

 two or more values (e.g.

 `fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE`)

 **Default:** `0`.

 * `fs.constants.COPYFILE_EXCL`: The copy operation will fail if `dest`

 already exists.

 * `fs.constants.COPYFILE_FICLONE`: The copy operation will attempt to create

 a copy-on-write reflink. If the platform does not support copy-on-write,

 then a fallback copy mechanism is used.

 * `fs.constants.COPYFILE_FICLONE_FORCE`: The copy operation will attempt to

 create a copy-on-write reflink. If the platform does not support

 copy-on-write, then the operation will fail.

 * Returns: {Promise} Fulfills with `undefined` upon success.



 Asynchronously copies `src` to `dest`. By default, `dest` is overwritten if it

 already exists.

 [View remainder of file in raw view](https://github.com/nodejs/node/raw/refs/tags/v22.22.0/doc/api/fs.md)
