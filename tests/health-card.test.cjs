const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// Exercise the actual github-script body so tests cannot drift from the workflow.
const workflow = readFileSync(join(__dirname, '../.github/workflows/github-stats.yml'), 'utf8');
const body = workflow.split('          script: |\n')[1].split('\n      - name:')[0]
  .split('\n').map(line => line.replace(/^            /, '')).join('\n');
const run = new (Object.getPrototypeOf(async function () {}).constructor)('github', 'require', 'Date', body);
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-10-11T00:30:00Z'])); }
}
async function generate({ repos = 7, count = 0, fail = false, Clock = FixedDate } = {}) {
  const writes = [];
  let request;
  const github = { graphql: async (query, variables) => {
    request = { query, variables };
    if (fail) throw new Error('API unavailable');
    return { user: { repositories: { totalCount: repos }, contributionsCollection: {
      contributionCalendar: { totalContributions: count }, totalCommitContributions: count,
      totalPullRequestContributions: count, totalIssueContributions: count,
    } } };
  } };
  const promise = run(github, name => {
    assert.equal(name, 'fs');
    return { writeFileSync: (path, svg) => writes.push({ path, svg }) };
  }, Clock);
  return { promise, writes, get request() { return request; } };
}
test('repository count and grade change with API activity', async () => {
  const low = await generate({ repos: 0 }); await low.promise;
  const high = await generate({ repos: 108, count: 2000 }); await high.promise;
  assert.match(low.writes[0].svg, />0\/100</);
  assert.match(high.writes[0].svg, />108</);
  assert.match(high.writes[0].svg, />100\/100</);
  assert.match(high.writes[0].svg, />A\+</);
  assert.match(high.request.query, /repositories\(privacy: PUBLIC, ownerAffiliations: \[OWNER\]\)/);
  assert.equal(high.writes[0].path, 'profile/health-grade.svg');
});
test('UTC year boundary and visible refresh time', async () => {
  class NewYear extends FixedDate {
    constructor(...args) { super(...(args.length ? args : ['2027-01-01T00:01:00Z'])); }
  }
  const result = await generate({ Clock: NewYear }); await result.promise;
  assert.equal(result.request.variables.from, '2027-01-01T00:00:00.000Z');
  assert.equal(result.request.variables.to, '2027-01-01T00:01:00.000Z');
  assert.match(result.writes[0].svg, /Updated 2027-01-01 00:01 UTC/);
});
test('zero activity produces an empty progress ring', async () => {
  const result = await generate({ repos: 0 }); await result.promise;
  assert.match(result.writes[0].svg, /stroke-dasharray='0 400'/);
});
test('API failures leave the saved card untouched', async () => {
  const result = await generate({ fail: true });
  await assert.rejects(result.promise, /API unavailable/);
  assert.deepEqual(result.writes, []);
});
test('missing or invalid counts never produce fabricated values', async () => {
  for (const repos of [null, -1, '73', NaN]) {
    const result = await generate({ repos });
    await assert.rejects(result.promise, /invalid activity count/);
    assert.deepEqual(result.writes, []);
  }
});
