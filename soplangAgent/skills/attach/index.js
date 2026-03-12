import attach from "./attach.js";

export async function action(args = {}) {
  const { input, ...context } = args || {};
  return attach(input, context);
}
