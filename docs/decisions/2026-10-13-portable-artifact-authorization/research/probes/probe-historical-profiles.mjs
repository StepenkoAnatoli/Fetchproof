// Research experiment: synthetic passing corpora, actual pinned historical writer.
// Run in an isolated child environment; no collection and no consumer config is used.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [currentKit, historicalKit, outputDir] = process.argv.slice(2).map((value) => path.resolve(value));
const load = (kit, file) => import(pathToFileURL(path.join(kit, file)).href);
const fixtures = await load(currentKit, 'test/artifact-fixtures.mjs');
const currentArtifact = await load(currentKit, 'lib/artifact.mjs');
const historicalArtifact = await load(historicalKit, 'lib/artifact.mjs');
const currentBrief = await load(currentKit, 'lib/brief.mjs');
const historicalBrief = await load(historicalKit, 'lib/brief.mjs');
const { readCorpus } = await load(currentKit, 'lib/corpus.mjs');
const { validateArtifact } = await load(currentKit, 'lib/artifact-validator.mjs');
fs.mkdirSync(outputDir, { recursive: true });
const records = [];
for (const profile of ['unstamped', 'pre-0069', 'current']) {
  const root = fixtures.approvedProject();
  const file = path.join(root, 'research', 'BRIEF.md');
  const authored = fs.readFileSync(file, 'utf8').replace(/\n?<!-- research-kit:brief-draft[^>]*-->\s*/g, '\n');
  if (profile === 'unstamped') fs.writeFileSync(file, authored);
  else if (profile === 'pre-0069') {
    historicalBrief.renderBrief(root, { force: true });
    const stamp = fs.readFileSync(file, 'utf8').match(/<!-- research-kit:brief-draft[^>]*-->/)?.[0];
    if (!stamp) throw new Error('the historical writer did not emit its actual stamp');
    fs.writeFileSync(file, `${authored.trimEnd()}\n\n${stamp}\n`);
  }
  const producer = profile === 'current' ? currentArtifact : historicalArtifact;
  const built = producer.createArtifact({ root, ...fixtures.IDENTITY, createdAt: '2026-10-13T00:00:00.000Z' });
  const packageFile = path.join(outputDir, `${profile}.zip`);
  fs.writeFileSync(packageFile, built.bytes);
  const snapshot = readCorpus(root);
  const text = fs.readFileSync(file, 'utf8');
  const stamp = currentBrief.draftStamp(text);
  const validation = validateArtifact({ file: packageFile });
  records.push({ profile, syntheticInputs: true,
    writerCommit: profile === 'current' ? '3fa03fa1749d591af9cd7197e1c09f66ffacd231' : '3bac1f26ddbf8cb6a794626e53dc2af313860940',
    formatVersion: built.manifest.formatVersion, producerState: built.manifest.state,
    producerAuthorized: built.manifest.buildAuthorized, consumerStatus: validation.status,
    consumerAuthorized: validation.buildAuthorized, stamp,
    stampHasGate: /<!-- research-kit:brief-draft[^>]* gate=/.test(text),
    historicalInputs: historicalBrief.briefInputsHash(snapshot), currentInputs: currentBrief.briefInputsHash(snapshot),
    currentProducerState: currentArtifact.deriveState(root).state,
    briefText: text,
  });
}
fs.writeFileSync(path.join(outputDir, 'profiles.json'), `${JSON.stringify(records, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(records.map(({ briefText, ...record }) => record), null, 2)}\n`);
