// Read-only cross-reference validator for the R29 reviewer-workbook linkage register.
const TASK_IDS = ['ST-01','ST-02','ST-03','ST-04','VO-01','VO-02','VO-03','VO-04','CO-01','CO-02','CO-03','CO-04','UN-01','UN-02','UN-03','UN-04','CC-01','CC-02','CC-03','CC-04','AE-01','AE-02','AE-03','AE-04'];
const EXPECTED = { task: 'R29-01', gold: 'R29-02', source: 'R29-03', calibration: 'R29-04', warm: 'R29-05', lock: 'R29-06' };
const RANK = { PASS: 0, INCOMPLETE: 1, FAIL: 2, REOPEN: 3 };
const LIVE_REASON = 'Live task excluded by R29-05 Frozen-only warm-manifest scope';

function error(errors, row, code, message, status = 'FAIL') { errors.push({ taskId: row?.taskId ?? null, code, message, status }); }
function statusOf(errors) { return errors.reduce((current, item) => RANK[item.status] > RANK[current] ? item.status : current, 'PASS'); }
function key(link) { return `${link.artifactId}\0${link.recordId}\0${link.memberKey}`; }
function sameLink(left, right) { return ['artifactId','recordId','recordHash','payloadSha256','memberKey','memberHash'].every((field) => left[field] === right[field]); }

export function validateR29WorkbookLinkage({ register, catalog, pointer } = {}) {
  const errors = [];
  if (!register || register.registerVersion !== '1.0.0' || register.profile !== 'researcher-benchmark-c14n-v1' || !Array.isArray(register.rows)) {
    error(errors, null, 'R29-REGISTER', 'register version, profile, or rows is invalid', 'INCOMPLETE');
    return { validatorVersion: '1.0.0', status: statusOf(errors), rows: [], errors };
  }
  const seen = new Set();
  const recordIndex = new Map();
  for (const record of catalog?.records ?? []) {
    const identity = key(record);
    if (recordIndex.has(identity)) error(errors, null, 'R29-CATALOG-DUPLICATE', 'explicit catalog repeats an artifact/record/member identity');
    else recordIndex.set(identity, record);
  }
  const pointerReady = pointer?.package === 'R29' && pointer?.state === 'ready';
  if (!pointerReady) error(errors, null, 'R29-POINTER-STATE', 'R29 lock pointer is not current ready', 'REOPEN');
  const outputs = [];
  for (const row of register.rows) {
    const local = [];
    if (!TASK_IDS.includes(row.taskId)) error(local, row, 'R29-TASK-ID', 'taskId is not approved', 'FAIL');
    if (seen.has(row.taskId)) error(local, row, 'R29-TASK-DUPLICATE', 'taskId appears more than once', 'FAIL');
    seen.add(row.taskId);
    for (const [name, artifactId] of Object.entries(EXPECTED)) {
      const link = row.links?.[name];
      if (!link) { error(local, row, 'R29-LINK-MISSING', `${name} link is absent`, 'INCOMPLETE'); continue; }
      if (link.artifactId !== artifactId) error(local, row, 'R29-LINK-ARTIFACT', `${name} link must identify ${artifactId}`);
      if (link.memberKey !== row.taskId) error(local, row, 'R29-LINK-MEMBER-KEY', `${name} memberKey does not equal taskId`);
      const record = recordIndex.get(key(link));
      if (!record) error(local, row, 'R29-LINK-RESOLVE', `${name} link does not resolve in explicit catalog`, 'INCOMPLETE');
      else if (record.state !== 'sealed') error(local, row, 'R29-LINK-STATE', `${name} record is not sealed`);
      else if (!sameLink(link, record)) error(local, row, 'R29-LINK-HASH', `${name} hash fields do not match catalog`);
    }
    const { task, gold, source, calibration, warm, lock } = row.links ?? {};
    const records = { task: task && recordIndex.get(key(task)), gold: gold && recordIndex.get(key(gold)), source: source && recordIndex.get(key(source)), calibration: calibration && recordIndex.get(key(calibration)), warm: warm && recordIndex.get(key(warm)), lock: lock && recordIndex.get(key(lock)) };
    const hasPredecessors = (record, hashes) => hashes.every((hash) => record?.predecessorRecordHashes?.includes(hash));
    if (gold && !hasPredecessors(records.gold, [task?.recordHash, source?.recordHash])) error(local, row, 'R29-GOLD-PREDECESSOR', 'gold does not name matching task and source records');
    if (calibration && (!hasPredecessors(records.calibration, [gold?.recordHash, source?.recordHash]) || records.calibration?.trapId !== `${row.taskId}-T`)) error(local, row, 'R29-CALIBRATION-LINK', 'calibration predecessor or trap link is invalid');
    if (row.track === 'Live') {
      if (warm?.memberState !== 'NOT-APPLICABLE' || warm?.memberHash !== null || warm?.warmScopeReason !== LIVE_REASON) error(local, row, 'R29-WARM-LIVE', 'Live row has an invented warm member or wrong fixed rationale');
    } else if (warm?.memberState !== 'PRESENT' || typeof warm?.memberHash !== 'string' || !hasPredecessors(records.warm, [task?.recordHash, source?.recordHash])) error(local, row, 'R29-WARM-FROZEN', 'Frozen row warm member or predecessors are invalid');
    if (lock && (!hasPredecessors(records.lock, [task?.recordHash, gold?.recordHash, source?.recordHash, calibration?.recordHash, warm?.recordHash]) || records.lock?.predecessorClosureHash !== lock.predecessorClosureHash || !pointer?.targetHashes?.includes(lock.payloadSha256))) error(local, row, 'R29-LOCK-CLOSURE', 'lock closure or current pointer does not bind row links', pointerReady ? 'FAIL' : 'REOPEN');
    if (!pointerReady) error(local, row, 'R29-POINTER-STATE', 'R29 lock pointer is not current ready', 'REOPEN');
    outputs.push({ taskId: row.taskId, status: statusOf(local), errors: local });
    errors.push(...local);
  }
  for (const taskId of TASK_IDS) if (!seen.has(taskId)) error(errors, { taskId }, 'R29-TASK-MISSING', 'approved task row is absent', 'INCOMPLETE');
  return { validatorVersion: '1.0.0', status: statusOf(errors), rows: outputs, errors };
}
