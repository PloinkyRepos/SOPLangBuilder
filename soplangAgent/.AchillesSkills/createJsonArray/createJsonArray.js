/**
 * Creates a JSON string representation of an array from the given input arguments.
 * @param {any[]} input - An array of arguments passed to the skill.
 * @param {object} context - The execution context (not used in this skill).
 * @returns {string} A string containing the JSON representation of the input array.
 */
export default async function createJsonArray(input, context = {}) {
    // The 'input' parameter directly receives all arguments as an array.
    // We just need to stringify it.
    if (!Array.isArray(input)) {
        // Handle cases where it might be called with a single non-array value
        return JSON.stringify([input]);
    }
    return JSON.stringify(input);
}
