// dimensions.mjs - the universal, domain-agnostic subtopic checklist.
//
// Nine dimensions every topic is seeded with. A recipe ADDS domain dimensions on top of
// this set; nothing replaces it, because a recipe that silently dropped legality would
// be worse than no recipe.
//
// `subtopic-coverage` fails a map that OMITS a dimension. Dismissing is fine.

export const UNIVERSAL_DIMENSIONS = Object.freeze([
  {
    id: 'D-1',
    name: 'Access model',
    why: 'Public pages, an official API, an auth-walled app, or a paywall - each is a different collection design',
    match: ['access model', 'access'],
  },
  {
    id: 'D-2',
    name: 'Auth and credentials',
    why: 'What accounts, keys, or logins the collection and the product need, and who holds them',
    match: ['auth and credentials', 'auth', 'credentials', 'authentication'],
  },
  {
    id: 'D-3',
    name: 'Rate limits and quotas',
    why: 'Caps every cadence in the design, and caps the research collection itself',
    match: ['rate limits and quotas', 'rate limit', 'quota', 'throttl'],
  },
  {
    id: 'D-4',
    name: 'ToS, licensing, legality of the intended use',
    why: 'A prohibition on automated collection, storage, or display ends the design for that source - and sometimes the project',
    match: ['tos', 'terms of service', 'licen', 'legality', 'legal'],
  },
  {
    id: 'D-5',
    name: 'Data schema and its stability',
    why: 'How the data is shaped, and how often the source changes the shape without asking',
    match: ['schema', 'data shape', 'stability'],
  },
  {
    id: 'D-6',
    name: 'Freshness and staleness',
    why: 'How fast the data goes stale, and what staleness costs the product that depends on it',
    match: ['freshness', 'stale'],
  },
  {
    id: 'D-7',
    name: 'Cost at expected volume',
    why: "The economics at real usage, not the pricing page's first row - this decides viability",
    match: ['cost at expected volume', 'cost', 'pricing', 'econom'],
  },
  {
    id: 'D-8',
    name: 'Runtime and platform limits',
    why: 'Where this actually executes - OS, runtime version, desktop app, cloud - and what those limits forbid',
    match: ['runtime and platform', 'runtime', 'platform limit'],
  },
  {
    id: 'D-9',
    name: 'Output obtainability',
    why: 'Does the data your stated "done" depends on exist, and can you actually get it? Load-bearing: a project whose output cannot be produced should die in phase 1, not phase 2',
    match: ['output obtainability', 'obtainab', 'output'],
  },
]);

function normalize(text) {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Mechanical presence-matching: which universal dimensions a map's rows mention, and
 * which it omits entirely. It judges PRESENCE, never quality - a status is the agent's.
 */
export function coverageOfUniversals(subtopics = []) {
  const haystacks = subtopics.map((row) => ({ row, text: normalize(`${row.id ?? ''} ${row.text ?? ''}`) }));
  const present = [];
  const missing = [];
  for (const dimension of UNIVERSAL_DIMENSIONS) {
    const hit = haystacks.find(({ row, text }) => (
      String(row.id ?? '').toUpperCase() === dimension.id
      || dimension.match.some((needle) => text.includes(normalize(needle)))
    ));
    if (hit) present.push({ dimension, row: hit.row });
    else missing.push({ dimension });
  }
  return { present, missing };
}

/** The seeded rows a draft MAP.md is born with: statuses BLANK, never an answer. */
export function seedRows(extra = []) {
  const rows = UNIVERSAL_DIMENSIONS.map((d) => ({ id: d.id, text: d.name, why: d.why, status: '', coveredBy: '' }));
  extra.forEach((dimension, index) => {
    rows.push({
      id: `S-${index + 1}`,
      text: dimension.name ?? String(dimension),
      why: dimension.why ?? '',
      status: '',
      coveredBy: '',
    });
  });
  return rows;
}
