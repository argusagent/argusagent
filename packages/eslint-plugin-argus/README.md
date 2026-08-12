# eslint-plugin-argus

> In the myth, Argus Panoptes had a hundred eyes — a few always open, always
> watching. This plugin is three of them.

Rules for bugs that pattern-match as *fine* in review: the promise quietly
discarded by an array method, the cached loop bound that a `splice` three
branches deeper just invalidated, the `TODO` nobody will ever find again.

## Install

```sh
npm install --save-dev eslint eslint-plugin-argus
```

## Use (flat config)

```js
// eslint.config.js
import argus from "eslint-plugin-argus";

export default [
  argus.configs.recommended,
];
```

Or pick rules individually:

```js
import argus from "eslint-plugin-argus";

export default [
  {
    plugins: { argus },
    rules: {
      "argus/no-async-array-callback": "error",
      "argus/no-stale-length-cache": "error",
      "argus/no-unflagged-todo": "warn",
    },
  },
];
```

## Rules

### `argus/no-async-array-callback`

Array iteration methods call their callback synchronously and use its return
value directly — hand them an `async` callback and the Promise goes somewhere
useless:

```js
jobs.filter(async (job) => await job.canRetry());
// a Promise is always truthy → this predicate matches EVERYTHING

jobs.forEach(async (job) => { await job.run(); });
// promises discarded → nothing awaits them, rejections are lost

names.sort(async (a, b) => rank(a) - rank(b));
// comparator returns a Promise, not a number → arbitrary order
```

Flags `forEach`, `filter`, `some`, `every`, `find`, `findIndex`, `findLast`,
`findLastIndex`, `sort`, `toSorted`, and `flatMap`. Deliberately does **not**
flag `map`: `Promise.all(xs.map(async …))` is the idiomatic fix.

💡 For a bare `xs.forEach(async cb)` statement in an awaitable context, the
rule offers an editor suggestion rewriting it to
`await Promise.all(xs.map(async cb))` — same concurrency, but rejections
surface.

### `argus/no-stale-length-cache`

The cached-length loop is fine — until the body mutates the array:

```js
for (let i = 0, n = jobs.length; i < n; i++) {
  if (jobs[i].done) jobs.splice(i, 1);
  // n is now a lie: the loop walks past the new end
}
```

Flags a `for` loop that caches `<array>.length` in its init clause and then
calls `push` / `pop` / `shift` / `unshift` / `splice` on that array (or
assigns to its `.length`) anywhere in the body — including inside nested
callbacks, which run while the loop is live.

💡 Offers an editor suggestion replacing the cached bound with a live
`array.length` read in the condition. It's a suggestion rather than an
autofix on purpose: iterating the *original* extent while appending is a
legitimate pattern, so a human confirms the intent.

### `argus/no-unflagged-todo`

A `TODO` with no reference is a promise with no witness:

```js
// TODO: handle pagination            ✗ untrackable
// TODO(#87): handle pagination       ✓ issue number
// FIXME PROJ-441: races on dblclick  ✓ tracker key
// TODO https://…/issues/87           ✓ URL
```

Matches `TODO`, `FIXME`, `HACK`, `XXX` by default; configure with
`{ "terms": ["todo", "review"] }`.

## Develop

```sh
npm install
npm test   # node:test + ESLint RuleTester, no other dependencies
```

## License

MIT
