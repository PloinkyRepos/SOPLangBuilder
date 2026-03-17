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
                    const promptText = Array.isArray(inputValues)
                        ? inputValues.join(" ")
                        : (typeof inputValues === "string" ? inputValues : "");
                    const out = await agent.executeWithReviewMode(promptText, { skillName: record.name }, "none");
                    if (out && typeof out === "object" && Object.prototype.hasOwnProperty.call(out, "result")) {
                        return out.result;
                    }
                    return out;
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

        async executeSkill(skillName, promptText = "") {
            if (!skillName || typeof skillName !== "string") {
                throw new Error("skillName is required");
            }

            const text = Array.isArray(promptText)
                ? promptText.join(" ")
                : (typeof promptText === "string" ? promptText : "");

            await registerSkills();
            await ensureAgent();
            const result = await agent.executeWithReviewMode(text, { skillName }, "none");
            if (result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "result")) {
                return result.result;
            }
            return result;
        }
    };
};
