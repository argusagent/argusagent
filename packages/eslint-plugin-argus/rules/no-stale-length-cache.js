/**
 * The classic cached-length loop:
 *
 *     for (let i = 0, n = items.length; i < n; i++) { … }
 *
 * is fine — until the body mutates `items`. Then the cached bound is stale:
 * removals walk past the new end (undefined reads), additions are silently
 * skipped. The mutation is usually buried a few branches deep, which is
 * exactly how it slips through review.
 *
 * Flags a for-loop that caches `<array>.length` in its init clause and then,
 * anywhere in its body (including nested functions, which run during the
 * loop), calls a length-changing method on that same array or assigns to its
 * `.length`.
 */

const MUTATORS = new Set(["push", "pop", "shift", "unshift", "splice"]);

/** Walk an ESTree subtree, skipping cycles via the `parent` back-reference. */
function* walk(node) {
  if (!node || typeof node.type !== "string") return;
  yield node;
  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) yield* walk(item);
    } else if (value && typeof value.type === "string") {
      yield* walk(value);
    }
  }
}

function referencesIdentifier(root, name) {
  for (const node of walk(root)) {
    if (node.type === "Identifier" && node.name === name) return true;
  }
  return false;
}

export default {
  meta: {
    type: "problem",
    hasSuggestions: true,
    docs: {
      description:
        "Disallow mutating an array inside a for-loop that cached its length as the bound",
    },
    messages: {
      stale:
        "This loop's bound `{{cached}}` caches `{{array}}.length`, but `{{array}}` is mutated inside the loop, so the cached bound goes stale. Read `{{array}}.length` in the loop condition instead.",
      suggestLiveLength:
        "Read `{{array}}.length` directly in the loop condition",
    },
    schema: [],
  },

  create(context) {
    return {
      ForStatement(node) {
        if (!node.init || node.init.type !== "VariableDeclaration") return;

        for (const decl of node.init.declarations) {
          const init = decl.init;
          if (
            !init ||
            init.type !== "MemberExpression" ||
            init.computed ||
            init.property.type !== "Identifier" ||
            init.property.name !== "length" ||
            init.object.type !== "Identifier" ||
            decl.id.type !== "Identifier"
          ) {
            continue;
          }
          const arrayName = init.object.name;
          const cachedName = decl.id.name;

          // Only a bound that the loop actually tests against can go stale.
          if (!node.test || !referencesIdentifier(node.test, cachedName)) {
            continue;
          }

          for (const inner of walk(node.body)) {
            const isMutatorCall =
              inner.type === "CallExpression" &&
              inner.callee.type === "MemberExpression" &&
              !inner.callee.computed &&
              inner.callee.object.type === "Identifier" &&
              inner.callee.object.name === arrayName &&
              inner.callee.property.type === "Identifier" &&
              MUTATORS.has(inner.callee.property.name);
            const isLengthWrite =
              inner.type === "AssignmentExpression" &&
              inner.left.type === "MemberExpression" &&
              !inner.left.computed &&
              inner.left.object.type === "Identifier" &&
              inner.left.object.name === arrayName &&
              inner.left.property.type === "Identifier" &&
              inner.left.property.name === "length";

            if (isMutatorCall || isLengthWrite) {
              // Not an autofix: iterating the ORIGINAL extent while appending
              // is a legitimate pattern, so a human confirms the intent.
              const boundReads = [...walk(node.test)].filter(
                (n) => n.type === "Identifier" && n.name === cachedName,
              );
              context.report({
                node: inner,
                messageId: "stale",
                data: { array: arrayName, cached: cachedName },
                suggest: [
                  {
                    messageId: "suggestLiveLength",
                    data: { array: arrayName },
                    fix: (fixer) =>
                      boundReads.map((read) =>
                        fixer.replaceText(read, `${arrayName}.length`),
                      ),
                  },
                ],
              });
              break;
            }
          }
        }
      },
    };
  },
};
