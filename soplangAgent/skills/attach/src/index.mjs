import attach from "./attach.mjs";

export async function action(args = {}) {
  const { input, ...context } = args || {};
  return attach(input, context);
}
