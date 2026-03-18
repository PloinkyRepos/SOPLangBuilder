/**
 * Creates a JSON string representation of an array from the given input arguments.
 * @param {any[]} input - An array of arguments passed to the skill.
 * @param {object} context - The execution context (not used in this skill).
 * @returns {string} A string containing the JSON representation of the input array.
 */
export default async function createJsonArray(input, context = {}) {
    if (!Array.isArray(input)) {
        return JSON.stringify([input]);
    }
    return JSON.stringify(input);
}
