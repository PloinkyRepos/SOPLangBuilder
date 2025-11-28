import path from "node:path";
import { fileURLToPath } from "node:url";
import { RecursiveSkilledAgent } from "achillesAgentLib";

const parseArgs = (inputValues) => {
    if (!inputValues || !inputValues.length) {
        return {};
    }
    if (inputValues.length === 1) {
        return normalizeValue(inputValues[0]);
    }
    if (inputValues.length % 2 === 0) {
        const obj = {};
        for (let i = 0; i < inputValues.length; i += 2) {
            const key = String(inputValues[i]);
            obj[key] = normalizeValue(inputValues[i + 1]);
        }
        return obj;
    }
    return { value: inputValues.map((value) => normalizeValue(value)) };
};

const normalizeValue = (value) => {
    if (value === undefined || value === null) {
        return value;
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) {
            return "";
        }
        try {
            return JSON.parse(trimmed);
        } catch {
            return trimmed;
        }
    }
    return value;
};

async function AchillesSkills() {
    const self = {};
    const workspace = $$.loadPlugin("Workspace");
    let agent = null;
    const registered = new Set();

    const ensureAgent = async () => {
        if (agent) return agent;
        const pluginDir = path.dirname(fileURLToPath(import.meta.url));
        const startDir = path.resolve(pluginDir, "..");
        agent = new RecursiveSkilledAgent({
            startDir,
            searchUpwards: true
        });
        if (Array.isArray(agent.pendingPreparations) && agent.pendingPreparations.length) {
            await Promise.allSettled(agent.pendingPreparations);
            agent.pendingPreparations = [];
        }
        return agent;
    };

    const registerSkills = async () => {
        await ensureAgent();
        const skills = Array.from(agent.skillCatalog.values());
        for (const record of skills) {
            const names = [record.name, record.shortName].filter(Boolean);
            for (const cmd of names) {
                if (registered.has(cmd)) continue;
                workspace.registerCommand(cmd, async (inputValues) => {
                    await ensureAgent();
                    const parsed = parseArgs(inputValues);
                if (record.type === "code") {
                    const baseArgs = (parsed && typeof parsed === "object" && !Array.isArray(parsed))
                        ? { ...parsed }
                        : { value: parsed };
                    if (baseArgs.input === undefined) {
                            try {
                                baseArgs.input = JSON.stringify(baseArgs);
                            } catch {
                                baseArgs.input = String(baseArgs.value ?? "");
                            }
                        }
                        const out = await agent.executeWithReviewMode("", { skillName: record.name, args: baseArgs }, "none");
                        if (out && typeof out === "object" && Object.prototype.hasOwnProperty.call(out, "result")) {
                            return out.result;
                        }
                        return out;
                    }
                    return agent.executeWithReviewMode("", { skillName: record.name, args: parsed }, "none");
                });
                registered.add(cmd);
            }
        }
        return skills.length;
    };

    await registerSkills();

    self.reload = async function () {
        agent = null;
        registered.clear();
        return registerSkills();
    };

    return self;
}

let singleton = undefined;

export async function getInstance() {
    if (!singleton) {
        singleton = await AchillesSkills();
    }
    return singleton;
}

export function getAllow() {
    return async function () {
        return true;
    };
}

export function getDependencies() {
    return ["Workspace"];
}
