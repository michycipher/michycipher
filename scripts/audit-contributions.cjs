const fs = require('node:fs');

// Query every year explicitly: an unavailable year must never become a zero.
async function collectYears(graphql, login, now = new Date()) {
  const metadata = await graphql(`query($login: String!) {
    user(login: $login) { createdAt contributionsCollection { contributionYears } }
  }`, { login });
  const firstYear = new Date(metadata.user.createdAt).getUTCFullYear();
  const currentYear = now.getUTCFullYear();
  if (!Number.isInteger(firstYear) || firstYear > currentYear) {
    throw new Error('Invalid GitHub account creation date');
  }
  const years = new Set(metadata.user.contributionsCollection.contributionYears);
  for (let year = firstYear; year <= currentYear; year++) years.add(year);
  const totals = [];
  for (const year of [...years].sort((a, b) => a - b)) {
    if (!Number.isInteger(year) || year < 1 || year > currentYear) {
      throw new Error('Invalid contribution year');
    }
    const from = `${year}-01-01T00:00:00Z`;
    const to = year === currentYear ? now.toISOString() : `${year}-12-31T23:59:59Z`;
    const data = await graphql(`query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar { totalContributions }
        }
      }
    }`, { login, from, to });
    const count = data.user.contributionsCollection.contributionCalendar.totalContributions;
    if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Invalid count for ${year}`);
    totals.push({ year, count });
  }
  return totals;
}

function verifyTotal(svg, totals) {
  const match = svg.match(/<!-- Total Contributions big number -->[\s\S]*?<text\b[^>]*>\s*([\d,]+)\s*<\/text>/);
  if (!match) throw new Error('Cannot read total contributions from generated streak card');
  const total = totals.reduce((sum, item) => sum + item.count, 0);
  if (Number(match[1].replaceAll(',', '')) !== total) {
    throw new Error(`Streak card total does not match the complete year-by-year total (${total}). Retry the workflow; activity may have changed during generation.`);
  }
  return total;
}

async function audit({ github, login, now = new Date(), fileSystem = fs }) {
  const totals = await collectYears(github.graphql.bind(github), login, now);
  const total = verifyTotal(fileSystem.readFileSync('profile/streak.svg', 'utf8'), totals);
  const report = [
    '# Contributions by year', '',
    `Last verified: ${now.toISOString()}`, '',
    'Fetched directly from GitHub using the same token as the health and streak cards. The all-time sum below is checked against the generated streak card before publishing.', '',
    '| Year (UTC) | Contributions |', '| --- | ---: |',
    ...totals.map(({ year, count }) => `| ${year} | ${count.toLocaleString('en-US')} |`),
    `| **All time** | **${total.toLocaleString('en-US')}** |`, '',
    'The current year is year-to-date. These are GitHub contribution-calendar counts, not every commit ever made. Private activity depends on GitHub visibility settings and token access. A missing year or failed API request stops publication instead of silently reducing the total.', '',
  ].join('\n');
  fileSystem.writeFileSync('profile/contributions.md', report);
  return { total, totals };
}
module.exports = { collectYears, verifyTotal, audit };
