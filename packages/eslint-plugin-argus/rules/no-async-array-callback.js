/**
 * Array iteration methods call their callback synchronously and use its
 * return value directly. Handing them an async callback is almost always a
 * bug, but the shape of the bug differs by method, so the messages do too:
 *
 *   - forEach: the returned promises are discarded — nothing awaits them,
 *     errors vanish, and code after the loop runs before the callbacks do.
 *   - filter / some / every / find / findIndex / findLast / findLastIndex:
 *     the callback returns a Promise, and a Promise is always truthy, so the
 *     predicate is meaningless.
 *   - sort: the comparator returns a Promise, not a number, so the order is
 *     arbitrary.
 *   - flatMap: the promises are not flattened; you get an array of promises.
 *
 * `map` is deliberately not flagged: `Promise.all(xs.map(async …))` is the
 * idiomatic way to run async work over an array.
 */

const DISCARDED = new Set(["forEach"]);
const PREDICATE = new Set([
  "filter",
  "some",
  "every",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
]);
const COMPARATOR = new Set(["sort", "toSorted"]);
const FLATTENING = new Set(["flatMap"]);

const ALL = new Set([...DISCARDED, ...PREDICATE, ...COMPARATOR, ...FLATTENING]);

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow async callbacks in array methods that cannot handle a returned Promise",
    },
    messages: {
      discarded:
        "Async callback passed to `{{method}}`: the returned promises are discarded, so nothing awaits them and rejections are lost. Use `for…of` with `await`, or `Promise.all` over `map`.",
      predicate:
        "Async callback passed to `{{method}}`: it returns a Promise, and a Promise is always truthy, so this predicate matches everything. Resolve the values first, then {{method}}.",
      comparator:
        "Async comparator passed to `{{method}}`: it returns a Promise, not a number, so the sort order is arbitrary. Compute the sort keys first, then sort synchronously.",
      flattening:
        "Async callback passed to `{{method}}`: the promises are not awaited or flattened; this produces an array of promises. Use `Promise.all` over `map`, then flatten.",
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type !== "MemberExpression" ||
          callee.computed ||
          callee.property.type !== "Identifier" ||
          !ALL.has(callee.property.name)
        ) {
          return;
        }
        const method = callee.property.name;
        const cb = node.arguments[0];
        if (
          !cb ||
          !cb.async ||
          (cb.type !== "ArrowFunctionExpression" &&
            cb.type !== "FunctionExpression")
        ) {
          return;
        }
        const messageId = DISCARDED.has(method)
          ? "discarded"
          : PREDICATE.has(method)
            ? "predicate"
            : COMPARATOR.has(method)
              ? "comparator"
              : "flattening";
        context.report({ node: cb, messageId, data: { method } });
      },
    };
  },
};
