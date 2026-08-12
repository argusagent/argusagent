import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import rule from "../rules/no-stale-length-cache.js";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: "module" },
});

tester.run("no-stale-length-cache", rule, {
  valid: [
    // cached bound, no mutation: the classic (fine) micro-optimization
    "for (let i = 0, n = xs.length; i < n; i++) { sink(xs[i]); }",
    // live bound: mutation is safe because the condition re-reads length
    "for (let i = 0; i < xs.length; i++) { if (bad(xs[i])) xs.splice(i--, 1); }",
    // mutating a different array than the cached one
    "for (let i = 0, n = xs.length; i < n; i++) { ys.push(xs[i]); }",
    // cached variable never used in the test — not a bound
    "for (let i = 0, n = xs.length; i < 10; i++) { xs.push(i); }",
    // non-mutating method on the cached array
    "for (let i = 0, n = xs.length; i < n; i++) { xs.slice(0, i); }",
    // no init clause at all
    "for (;;) { xs.push(1); break; }",
  ],
  invalid: [
    {
      code: "for (let i = 0, n = xs.length; i < n; i++) { xs.push(xs[i]); }",
      errors: [{ messageId: "stale" }],
    },
    {
      code: "for (let i = 0, len = xs.length; i < len; i++) { if (bad(xs[i])) xs.splice(i, 1); }",
      errors: [{ messageId: "stale" }],
    },
    {
      code: "for (let i = 0, n = xs.length; i < n; i++) { xs.pop(); }",
      errors: [{ messageId: "stale" }],
    },
    {
      code: "for (let i = 0, n = xs.length; i < n; i++) { xs.shift(); }",
      errors: [{ messageId: "stale" }],
    },
    {
      // mutation buried in a branch and a nested callback still runs mid-loop
      code: "for (let i = 0, n = xs.length; i < n; i++) { maybe(() => { xs.unshift(0); }); }",
      errors: [{ messageId: "stale" }],
    },
    {
      code: "for (let i = 0, n = xs.length; i < n; i++) { xs.length = 0; }",
      errors: [{ messageId: "stale" }],
    },
    {
      // cached length declared second in the init clause
      code: "for (let i = 0, j = 1, n = xs.length; i < n; i++) { xs.push(i); }",
      errors: [{ messageId: "stale" }],
    },
  ],
});
