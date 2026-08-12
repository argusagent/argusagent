import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import rule from "../rules/no-async-array-callback.js";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: "module" },
});

tester.run("no-async-array-callback", rule, {
  valid: [
    // map is the idiomatic carrier for async work
    "await Promise.all(xs.map(async (x) => fetch(x)));",
    // sync callbacks are fine everywhere
    "xs.forEach((x) => sink(x));",
    "xs.filter((x) => x > 0);",
    "xs.sort((a, b) => a - b);",
    // async elsewhere is not this rule's business
    "setTimeout(async () => { await job(); }, 0);",
    "p.then(async (x) => x + 1);",
    // computed member access is out of scope
    "xs['forEach'](async (x) => x);",
    // a non-function first argument
    "xs.filter(Boolean);",
  ],
  invalid: [
    {
      // top level of a module: top-level await makes the rewrite legal
      code: "xs.forEach(async (x) => { await save(x); });",
      errors: [
        {
          messageId: "discarded",
          suggestions: [
            {
              messageId: "suggestPromiseAll",
              output:
                "await Promise.all(xs.map(async (x) => { await save(x); }));",
            },
          ],
        },
      ],
    },
    {
      code: "async function f() { queue.jobs.forEach(async function (x) { await save(x); }); }",
      errors: [
        {
          messageId: "discarded",
          suggestions: [
            {
              messageId: "suggestPromiseAll",
              output:
                "async function f() { await Promise.all(queue.jobs.map(async function (x) { await save(x); })); }",
            },
          ],
        },
      ],
    },
    {
      // inside a sync function there is nowhere to await: no suggestion
      code: "function f() { xs.forEach(async (x) => { await save(x); }); }",
      errors: [{ messageId: "discarded", suggestions: [] }],
    },
    {
      // result of forEach is (bizarrely) consumed: no rewrite offered
      code: "const r = xs.forEach(async (x) => { await save(x); });",
      errors: [{ messageId: "discarded", suggestions: [] }],
    },
    {
      code: "xs.filter(async (x) => await isValid(x));",
      errors: [{ messageId: "predicate" }],
    },
    {
      code: "xs.some(async (x) => check(x));",
      errors: [{ messageId: "predicate" }],
    },
    {
      code: "xs.every(async (x) => check(x));",
      errors: [{ messageId: "predicate" }],
    },
    {
      code: "xs.find(async (x) => await matches(x));",
      errors: [{ messageId: "predicate" }],
    },
    {
      code: "xs.findIndex(async (x) => await matches(x));",
      errors: [{ messageId: "predicate" }],
    },
    {
      code: "xs.sort(async (a, b) => rank(a) - rank(b));",
      errors: [{ messageId: "comparator" }],
    },
    {
      code: "xs.flatMap(async (x) => await expand(x));",
      errors: [{ messageId: "flattening" }],
    },
  ],
});
