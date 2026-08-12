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
      code: "xs.forEach(async (x) => { await save(x); });",
      errors: [{ messageId: "discarded" }],
    },
    {
      code: "xs.forEach(async function (x) { await save(x); });",
      errors: [{ messageId: "discarded" }],
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
