/**
 * A TODO with no issue reference is a promise with no witness: it can't be
 * scheduled, searched for from the tracker, or closed. Requires every
 * TODO/FIXME-style comment to carry a paper trail — an issue number
 * (`#123`), a tracker key (`PROJ-123`), or a URL.
 *
 *     // TODO: handle pagination                  ✗
 *     // TODO(#87): handle pagination             ✓
 *     // FIXME PROJ-441: races on double-click    ✓
 *     // TODO https://github.com/o/r/issues/87    ✓
 */

const DEFAULT_TERMS = ["todo", "fixme", "hack", "xxx"];
const REFERENCE = /#\d+|\b[A-Z][A-Z0-9]*-\d+\b|https?:\/\/\S+/;

export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Require TODO-style comments to reference an issue, tracker key, or URL",
    },
    messages: {
      unflagged:
        "`{{term}}` has no issue reference. Add one — `{{term}}(#123)`, a tracker key, or a link — so it can be tracked and closed.",
    },
    schema: [
      {
        type: "object",
        properties: {
          terms: {
            type: "array",
            items: { type: "string" },
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const terms = (context.options[0]?.terms ?? DEFAULT_TERMS).map((t) =>
      t.toLowerCase(),
    );
    const termPattern = new RegExp(
      `\\b(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
      "i",
    );

    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const match = comment.value.match(termPattern);
          if (match && !REFERENCE.test(comment.value)) {
            context.report({
              loc: comment.loc,
              messageId: "unflagged",
              data: { term: match[1].toUpperCase() },
            });
          }
        }
      },
    };
  },
};
