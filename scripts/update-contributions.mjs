#!/usr/bin/env node
/**
 * Regenerates the "Open source contributions" table in README.md.
 *
 * Sources, merged by (owner/repo#number):
 *   1. data/contributions.json — curated seed list, never dropped
 *   2. GitHub search API — every public PR authored by the configured user
 *
 * Status for each PR comes from the pulls endpoint (merged beats closed).
 * The table is written between the CONTRIBUTIONS:START/END markers; the
 * rest of the README is left untouched.
 *
 * Usage:
 *   node scripts/update-contributions.mjs           # update README.md in place
 *   node scripts/update-contributions.mjs --check   # print table, don't write
 *
 * Env:
 *   GITHUB_TOKEN        — optional; raises rate limits, required in CI
 *   CONTRIB_FIXTURES    — path to a JSON fixture file; skips all network
 *                         calls (used for offline tests)
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const README = path.join(ROOT, "README.md");
const SEED = path.join(ROOT, "data", "contributions.json");
const START = "<!-- CONTRIBUTIONS:START -->";
const END = "<!-- CONTRIBUTIONS:END -->";

const STATUS = {
  merged: "🟣 merged",
  open: "🟢 open",
  draft: "⚪ draft",
  closed: "🔴 closed",
  unknown: "❔ unknown",
};

const checkOnly = process.argv.includes("--check");

async function api(url) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "argusagent-readme-updater",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} for ${url}: ${await res.text()}`);
  }
  return res.json();
}

function key(pr) {
  return `${pr.owner}/${pr.repo}#${pr.number}`.toLowerCase();
}

/** PRs authored by `author`, discovered via the search API. Best-effort:
 * a search failure (rate limit, offline) degrades to the seed list alone. */
async function discover(author) {
  try {
    const q = encodeURIComponent(`author:${author} type:pr`);
    const data = await api(
      `https://api.github.com/search/issues?q=${q}&per_page=100&sort=created&order=desc`,
    );
    return (data.items ?? []).flatMap((item) => {
      const m = item.repository_url?.match(/repos\/([^/]+)\/([^/]+)$/);
      if (!m) return [];
      return [{ owner: m[1], repo: m[2], number: item.number }];
    });
  } catch (err) {
    console.warn(`search skipped: ${err.message}`);
    return [];
  }
}

async function fetchStatus(pr) {
  const data = await api(
    `https://api.github.com/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`,
  );
  const status = data.merged_at
    ? "merged"
    : data.state === "open"
      ? data.draft
        ? "draft"
        : "open"
      : "closed";
  return { ...pr, title: data.title, status, url: data.html_url };
}

function loadFixtures() {
  return readFile(process.env.CONTRIB_FIXTURES, "utf8").then(JSON.parse);
}

function renderTable(prs) {
  const rows = prs.map((pr) => {
    const what = pr.note ?? pr.title ?? "";
    const url = pr.url ?? `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}`;
    return `| [#${pr.number}](${url}) | ${pr.owner}/${pr.repo} | ${what} | ${STATUS[pr.status] ?? STATUS.unknown} |`;
  });
  return [
    "| PR | Repo | What | Status |",
    "|----|------|------|--------|",
    ...rows,
  ].join("\n");
}

const seed = JSON.parse(await readFile(SEED, "utf8"));
const seedPRs = seed.pull_requests;

let prs;
if (process.env.CONTRIB_FIXTURES) {
  const fixtures = await loadFixtures();
  const byKey = new Map(fixtures.map((f) => [key(f), f]));
  prs = seedPRs.map((pr) => ({ ...pr, ...byKey.get(key(pr)), note: pr.note }));
} else {
  const discovered = await discover(seed.author);
  const merged = new Map(seedPRs.map((pr) => [key(pr), pr]));
  for (const pr of discovered) {
    if (!merged.has(key(pr))) merged.set(key(pr), pr);
  }
  prs = await Promise.all(
    [...merged.values()].map(async (pr) => {
      try {
        const withStatus = await fetchStatus(pr);
        return { ...withStatus, note: pr.note };
      } catch (err) {
        console.warn(`status lookup failed for ${key(pr)}: ${err.message}`);
        return { ...pr, status: "unknown" };
      }
    }),
  );
}

// Merged work is the headline; within a status group, newest first.
const rank = { merged: 0, open: 1, draft: 2, closed: 3, unknown: 4 };
prs.sort(
  (a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || b.number - a.number,
);

const table = renderTable(prs);

if (checkOnly) {
  console.log(table);
  process.exit(0);
}

const readme = await readFile(README, "utf8");
const startIdx = readme.indexOf(START);
const endIdx = readme.indexOf(END);
if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
  console.error(`README.md is missing the ${START} / ${END} markers.`);
  process.exit(1);
}

const updated =
  readme.slice(0, startIdx + START.length) +
  "\n" +
  table +
  "\n" +
  readme.slice(endIdx);

if (updated === readme) {
  console.log("README already up to date.");
} else {
  await writeFile(README, updated);
  console.log("README updated.");
}
