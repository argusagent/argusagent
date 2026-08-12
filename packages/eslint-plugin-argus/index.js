import noAsyncArrayCallback from "./rules/no-async-array-callback.js";
import noStaleLengthCache from "./rules/no-stale-length-cache.js";
import noUnflaggedTodo from "./rules/no-unflagged-todo.js";

const plugin = {
  meta: {
    name: "eslint-plugin-argus",
    version: "0.1.0",
  },
  rules: {
    "no-async-array-callback": noAsyncArrayCallback,
    "no-stale-length-cache": noStaleLengthCache,
    "no-unflagged-todo": noUnflaggedTodo,
  },
};

plugin.configs = {
  recommended: {
    name: "argus/recommended",
    plugins: { argus: plugin },
    rules: {
      "argus/no-async-array-callback": "error",
      "argus/no-stale-length-cache": "error",
      "argus/no-unflagged-todo": "warn",
    },
  },
};

export default plugin;
