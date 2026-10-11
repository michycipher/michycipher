const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectYears, verifyTotal, audit } = require('../scripts/audit-contributions.cjs');
const now = new Date('2026-10-11T00:30:00Z');
function api(counts, failure) {
  return async (query, variables) => {
    if (!variables.from) return { user: { createdAt: '2019-07-10T12:00:00Z', contributionsCollection: { contributionYears: [2026, 2025, 2019] } } };
    const year = Number(variables.from.slice(0, 4));
    if (year === failure) throw new Error('Year unavailable');
    assert.equal(variables.to, year === 2026 ? now.toISOString() : `${year}-12-31T23:59:59Z`);
    return { user: { contributionsCollection: { contributionCalendar: { totalContributions: counts[year] ?? 0 } } } };
  };
}
const svg = n => `<!-- Total Contributions big number --><g><text>${n}</text></g>`;
test('includes every year since creation, including zero years', async () => {
  const totals = await collectYears(api({ 2019: 100, 2025: 750, 2026: 702 }), 'example', now);
  assert.deepEqual(totals.map(x => x.year), [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
  assert.equal(verifyTotal(svg('1,552'), totals), 1552);
});
test('a failed historical year stops publication', async () => {
  let written = false;
  await assert.rejects(audit({ github: { graphql: api({}, 2020) }, login: 'example', now,
    fileSystem: { readFileSync: () => svg(0), writeFileSync: () => { written = true; } },
  }), /Year unavailable/);
  assert.equal(written, false);
});
test('rejects a stale or incomplete card and unexpected SVG structure', () => {
  assert.throws(() => verifyTotal(svg('702'), [{ year: 2025, count: 750 }, { year: 2026, count: 702 }]), /does not match/);
  assert.throws(() => verifyTotal('<svg/>', []), /Cannot read/);
});
test('rejects missing API counts', async () => {
  await assert.rejects(collectYears(api({ 2020: '0' }), 'example', now), /Invalid count/);
});
