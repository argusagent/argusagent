import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import rule from "../rules/no-unflagged-todo.js";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: "module" },
});

tester.run("no-unflagged-todo", rule, {
  valid: [
    "// TODO(#87): handle pagination",
    "// FIXME PROJ-441: races on double-click",
    "// TODO https://github.com/argusagent/argusagent/issues/1",
    "/* HACK(#12): remove after the v3 migration */",
    "// plain comment, nothing to track",
    "// mastodont migration notes — marker only matches on word boundaries",
    {
      code: "// REVIEW: is this right?",
      options: [{ terms: ["todo"] }],
    },
  ],
  invalid: [
    {
      code: "// TODO: handle pagination",
      errors: [{ messageId: "unflagged" }],
    },
    {
      code: "// fixme later",
      errors: [{ messageId: "unflagged" }],
    },
    {
      code: "/* XXX this whole block is suspect */",
      errors: [{ messageId: "unflagged" }],
    },
    {
      code: "// HACK around safari",
      errors: [{ messageId: "unflagged" }],
    },
    {
      code: "let x = 1; // TODO tighten type",
      errors: [{ messageId: "unflagged" }],
    },
    {
      code: "// REVIEW: is this right?",
      options: [{ terms: ["review"] }],
      errors: [{ messageId: "unflagged" }],
    },
  ],
});
