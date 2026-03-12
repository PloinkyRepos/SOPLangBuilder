export const normalizeValue = (value) => {
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

export const parseArgs = (inputValues) => {
    if (!inputValues || !inputValues.length) {
        return {};
    }

    if (inputValues.length === 1) {
        return normalizeValue(inputValues[0]);
    }

    if (inputValues.length % 2 === 0) {
        const result = {};
        for (let i = 0; i < inputValues.length; i += 2) {
            result[String(inputValues[i])] = normalizeValue(inputValues[i + 1]);
        }
        return result;
    }

    return { value: inputValues.map((value) => normalizeValue(value)) };
};

export const createAchillesSkills = async ({
    workspace,
    AgentClass,
    startDir
} = {}) => {
    if (!workspace) {
        throw new Error("workspace is required");
    }
    if (!AgentClass) {
        throw new Error("AgentClass is required");
    }
    if (!startDir) {
        throw new Error("startDir is required");
    }

    let agent = null;
    const registered = new Set();

    const ensureAgent = async () => {
        if (agent) {
            return agent;
        }

        agent = new AgentClass({
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
            for (const commandName of names) {
                if (registered.has(commandName)) {
                    continue;
                }

                workspace.registerCommand(commandName, async (inputValues) => {
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

                registered.add(commandName);
            }
        }

        return skills.length;
    };

    await registerSkills();

    return {
        async reload() {
            agent = null;
            registered.clear();
            return registerSkills();
        },

        async executeSkill(skillName, args = {}) {
            if (!skillName || typeof skillName !== "string") {
                throw new Error("skillName is required");
            }

            let parsedArgs = args;
            if (typeof parsedArgs === "string") {
                try {
                    parsedArgs = JSON.parse(parsedArgs);
                } catch (_) {
                    // Keep raw string if it is not JSON.
                }
            }

            await registerSkills();
            await ensureAgent();
            const result = await agent.executeWithReviewMode("", { skillName, args: parsedArgs }, "none");
            if (result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "result")) {
                return result.result;
            }
            return result;
        }
    };
};
