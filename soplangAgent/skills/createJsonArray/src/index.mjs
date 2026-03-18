import createJsonArray from "./createJsonArray.js";

export async function action(args = {}) {
  const { input, ...context } = args || {};
  return createJsonArray(input, context);
}
