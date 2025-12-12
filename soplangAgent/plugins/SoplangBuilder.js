import fs from "node:fs/promises";
import path from "node:path";
import { debug } from "./debugLogger.mjs";

const EXCLUDE_DIRS = new Set(["node_modules", ".git", ".ploinky", "dist"]);

const pickRoot = async () => {
    const candidates = [
        process.env.SOPLANG_WORKSPACE_ROOT,
        process.cwd(),
        path.resolve(process.cwd(), ".."),
        path.resolve(process.cwd(), "../..")
    ].filter(Boolean);

    for (const candidate of candidates) {
        try {
            const stat = await fs.stat(candidate);
            if (stat.isDirectory()) {
                return candidate;
            }
        } catch (_) {
            // ignore
        }
    }
    throw new Error("No valid workspace root found");
};

const walkMarkdown = async (root) => {
    const files = [];
    const stack = [root];
    while (stack.length) {
        const current = stack.pop();
        let entries = [];
        try {
            entries = await fs.readdir(current, { withFileTypes: true });
        } catch (_) {
            continue;
        }
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (EXCLUDE_DIRS.has(entry.name)) continue;
                stack.push(path.join(current, entry.name));
                continue;
            }
            if (entry.isFile() && entry.name.endsWith(".md")) {
                files.push(path.join(current, entry.name));
            }
        }
    }
    return files;
};

const parseMetadataComment = (raw) => {
    if (!raw) return null;
    try {
        return JSON.parse(raw.trim());
    } catch (_) {
        return null;
    }
};

const ensureDoc = (docs, docId) => {
    if (!docs[docId]) {
        docs[docId] = {
            docId,
            title: docId,
            infoText: "",
            commands: "",
            chapters: []
        };
    }
    return docs[docId];
};

const ensureChapter = (doc, meta = {}) => {
    const title = meta.title || `Chapter ${doc.chapters.length + 1}`;
    const chapter = {
        title,
        commands: meta.commands || "",
        paragraphs: []
    };
    doc.chapters.push(chapter);
    return chapter;
};

const ensureParagraph = (chapter, meta = {}) => {
    chapter.paragraphs.push({
        text: meta.text || "",
        commands: meta.commands || ""
    });
};

const registerAchillesCLISOPlangCommands = (workspace) => {
    debug.log("[SoplangBuilder] Registering custom Achilles CLI SOPLang commands...");

    // Command: load - Load content from a specification file
    // Syntax: @VAR load path/to/file.md#SECTION-ID
    workspace.registerCommand("load", async (inputValues, parsedCommand, currentDocId) => {
        const specRef = inputValues[0];
        if (!specRef || typeof specRef !== "string") {
            return undefined;
        }

        const [filePath, sectionId] = specRef.split("#");
        if (!filePath) {
            return undefined;
        }

        try {
            const root = await pickRoot();
            const fullPath = path.isAbsolute(filePath) ? filePath : path.join(root, ".specs", filePath);
            const content = await fs.readFile(fullPath, "utf8");

            if (sectionId) {
                // Extract section by ID (look for ## SECTION-ID header)
                const sectionRegex = new RegExp(`^##\\s+${sectionId}[\\s\\S]*?(?=^##\\s|$)`, "m");
                const match = content.match(sectionRegex);
                if (match) {
                    return match[0].trim();
                }
                // Try to find the section as an anchor in the content
                const anchorRegex = new RegExp(`#${sectionId}[\\s\\S]*?(?=^#|$)`, "gm");
                const anchorMatch = content.match(anchorRegex);
                if (anchorMatch) {
                    return anchorMatch[0].trim();
                }
            }

            return content.trim();
        } catch (err) {
            console.warn(`load command failed for ${specRef}: ${err.message}`);
            return undefined;
        }
    });
    debug.log("[SoplangBuilder] ✓ Registered command: load");

    // Command: createJSCode - Generate JavaScript code from a prompt using LLM
    // Syntax: @compiledFile createJSCode $prompt
    workspace.registerCommand("createJSCode", async (inputValues, parsedCommand, currentDocId) => {
        const prompt = inputValues.join(" ");
        if (!prompt || !prompt.trim()) {
            return undefined;
        }

        try {
            const llm = $$.loadPlugin("LLM");
            if (!llm || typeof llm.executePrompt !== "function") {
                console.warn("createJSCode: LLM plugin not available");
                return `// LLM not available - prompt was:\n// ${prompt.replace(/\n/g, "\n// ")}`;
            }

            const systemPrompt = `You are a code generator. Generate clean, modern JavaScript (ES modules, async/await) based on the specification provided. Output ONLY the code, no explanations or markdown fences.`;
            const result = await llm.executePrompt(prompt, {
                systemPrompt,
                responseShape: "text",
            });

            return typeof result === "string" ? result : JSON.stringify(result);
        } catch (err) {
            console.warn(`createJSCode command failed: ${err.message}`);
            return `// Code generation failed: ${err.message}\n// Prompt was:\n// ${prompt.replace(/\n/g, "\n// ")}`;
        }
    });
    debug.log("[SoplangBuilder] ✓ Registered command: createJSCode");

    // Command: store - Save content to a file
    // Syntax: @result store "path/to/output.js" $content
    workspace.registerCommand("store", async (inputValues, parsedCommand, currentDocId) => {
        const filePath = inputValues[0];
        const content = inputValues.slice(1).join(" ");

        if (!filePath || typeof filePath !== "string") {
            console.warn("store command: missing file path");
            return undefined;
        }

        try {
            const root = await pickRoot();
            const fullPath = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);

            // Ensure directory exists
            const dir = path.dirname(fullPath);
            await fs.mkdir(dir, { recursive: true });

            await fs.writeFile(fullPath, content || "", "utf8");
            return fullPath;
        } catch (err) {
            console.warn(`store command failed for ${filePath}: ${err.message}`);
            return undefined;
        }
    });
    debug.log("[SoplangBuilder] ✓ Registered command: store");
    debug.log("[SoplangBuilder] All custom SOPLang commands registered successfully");
};

const parseDocsFromMarkdown = (markdown, filePath) => {
    const docs = {};
    let currentDocId = path.basename(filePath, ".md");
    let currentChapter = null;

    const commentRe = /<!--([\s\S]*?)-->/g;
    let match;
    while ((match = commentRe.exec(markdown)) !== null) {
        const parsed = parseMetadataComment(match[1]);
        if (!parsed || typeof parsed !== "object") continue;

        if (parsed["achiles-ide-document"]) {
            const meta = parsed["achiles-ide-document"] || {};
            currentDocId = meta.id || currentDocId;
            const doc = ensureDoc(docs, currentDocId);
            doc.title = meta.title || doc.title;
            doc.infoText = meta.infoText || doc.infoText;
            if (meta.commands) {
                doc.commands = meta.commands;
            }
            currentChapter = null;
            continue;
        }

        if (parsed["achiles-ide-chapter"]) {
            const meta = parsed["achiles-ide-chapter"] || {};
            const doc = ensureDoc(docs, currentDocId);
            currentChapter = ensureChapter(doc, meta);
            continue;
        }

        if (parsed["achiles-ide-paragraph"]) {
            const meta = parsed["achiles-ide-paragraph"] || {};
            const doc = ensureDoc(docs, currentDocId);
            if (!currentChapter) {
                currentChapter = ensureChapter(doc, {});
            }
            ensureParagraph(currentChapter, meta);
        }
    }

    // ensure at least one chapter/paragraph
    Object.values(docs).forEach((doc) => {
        if (!doc.chapters.length) {
            const ch = ensureChapter(doc, {});
            ensureParagraph(ch, {});
        } else {
            doc.chapters.forEach((ch) => {
                if (!ch.paragraphs.length) {
                    ensureParagraph(ch, {});
                }
            });
        }
    });

    return docs;
};

async function SoplangBuilder() {
    debug.log("[SoplangBuilder] ========== INITIALIZING ==========");
    debug.log("[SoplangBuilder] ACHILLES_DEBUG:", process.env.ACHILLES_DEBUG || "(not set)");

    const self = {};
    const workspace = $$.loadPlugin("Workspace");
    const documents = $$.loadPlugin("Documents");

    debug.log("[SoplangBuilder] Loaded plugins: Workspace, Documents");

    // Register Achilles CLI SOPLang commands (load, createJSCode, store)
    registerAchillesCLISOPlangCommands(workspace);

    const getVarsWithValues = async () => {
        const vars = await workspace.getEveryVariableObject();
        const enriched = [];
        const parseMaybeJson = (value) => {
            if (typeof value !== "string") return value;
            const trimmed = value.trim();
            if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
            try {
                return JSON.parse(trimmed);
            } catch (_) {
                return value;
            }
        };
        for (const v of vars) {
            const varName = v.varName || v.name || v.varId;
            const docId = v.docId || v.documentId;
            if (!varName || !docId) {
                enriched.push(v);
                continue;
            }
            try {
                const raw = await workspace.getVarValue(docId, varName);
                v.value = parseMaybeJson(raw);
            } catch (err) {
                v.errorInfo = err?.message || String(err);
            }
            enriched.push(v);
        }
        return enriched;
    };

    self.buildFromMarkdown = async function () {
        const startedAt = Date.now();
        const root = await pickRoot();
        const files = await walkMarkdown(root);

        if (!files.length) {
            throw new Error(`No markdown files found under ${root}`);
        }

        const docTemplates = {};
        for (const filePath of files) {
            let content = "";
            try {
                content = await fs.readFile(filePath, "utf8");
            } catch (err) {
                console.warn("Failed to read file", filePath, err.message);
                continue;
            }
            const parsedDocs = parseDocsFromMarkdown(content, filePath);
            Object.entries(parsedDocs).forEach(([docId, docData]) => {
                const id = docId || path.basename(filePath, ".md");
                docData.docId = docData.docId || id;
                docData.title = docData.title || id;
                docData.category = docData.category || "category";
                docData.commands = docData.commands || "";
                docData.infoText = docData.infoText || "";
                docData.comments = docData.comments || {};
                docTemplates[id] = docTemplates[id] || docData;
            });
        }

        const created = [];
        const warnings = [];
        for (const [docId, docTemplate] of Object.entries(docTemplates)) {
            try {
                let docObj;
                try {
                    docObj = await documents.getDocument(docId);
                } catch (_) {
                    docObj = null;
                }

                if (!docObj) {
                    docObj = await documents.createDocument(docId, "category");
                } else {
                    // reset existing content
                    const existingChapters = Array.isArray(docObj.chapters) ? [...docObj.chapters] : [];
                    for (const chapterId of existingChapters) {
                        const chapter = await documents.getChapter(chapterId);
                        const paragraphs = Array.isArray(chapter.paragraphs) ? [...chapter.paragraphs] : [];
                        for (const paragraphId of paragraphs) {
                            await documents.deleteParagraph(chapterId, paragraphId);
                        }
                        await documents.deleteChapter(docId, chapterId);
                    }
                    const category = docTemplate.category || "category";
                    await documents.updateDocument(docId, docTemplate.title || docId, docId, category, docTemplate.infoText || "", docTemplate.commands || "", docTemplate.comments || {});
                }

                await documents.applyTemplate(docObj.id, docTemplate);
                created.push(docId);
            } catch (err) {
                warnings.push(`Failed to process ${docId}: ${err.message}`);
            }
        }

        await workspace.forceSave();
        await workspace.buildAll();

        const durationMs = Date.now() - startedAt;
        const buildErrors = $$.getBuildErrors?.() || [];
        return {
            created,
            scanned: files.length,
            warnings,
            errors: buildErrors,
            durationMs
        };
    };

    self.getVariablesWithValues = async function () {
        return await getVarsWithValues();
    };

    self.buildFromSpecsMarkdown = async function (root = null) {
        const startedAt = Date.now();
        const searchRoot = root || await pickRoot();

        debug.log("[buildFromSpecsMarkdown] ========== BUILD START ==========");
        debug.log("[buildFromSpecsMarkdown] Search root directory:", searchRoot);
        debug.log("[buildFromSpecsMarkdown] SOPLANG_WORKSPACE_ROOT env:", process.env.SOPLANG_WORKSPACE_ROOT || "(not set)");
        debug.log("[buildFromSpecsMarkdown] Current working directory:", process.cwd());

        const files = await walkMarkdown(searchRoot);

        debug.log("[buildFromSpecsMarkdown] Markdown files found:", files.length);
        if (debug.isEnabled()) {
            files.forEach((f, i) => debug.log(`  [${i + 1}] ${f}`));
        }

        if (!files.length) {
            debug.error("[buildFromSpecsMarkdown] No markdown files found!");
            throw new Error(`No markdown files found under ${searchRoot}`);
        }

        const soplangCodeBlocks = [];
        const matrixSoplangCode = [];

        for (const filePath of files) {
            let content = "";
            try {
                content = await fs.readFile(filePath, "utf8");
            } catch (err) {
                console.warn("Failed to read file", filePath, err.message);
                continue;
            }

            const parsedDocs = parseDocsFromMarkdown(content, filePath);
            const fileName = path.basename(filePath);

            // Extract commands from all documents parsed from this file
            Object.values(parsedDocs).forEach(doc => {
                if (doc.commands && doc.commands.trim()) {
                    if (fileName === "matrix.md") {
                        matrixSoplangCode.push(doc.commands.trim());
                    } else {
                        soplangCodeBlocks.push(doc.commands.trim());
                    }
                }
            });
        }

        // Ensure matrix.md soplang code appears first
        const allSoplangCode = [...matrixSoplangCode, ...soplangCodeBlocks].join('\n\n');

        debug.log("[buildFromSpecsMarkdown] SOPLang code blocks from matrix.md:", matrixSoplangCode.length);
        debug.log("[buildFromSpecsMarkdown] SOPLang code blocks from other files:", soplangCodeBlocks.length);
        debug.log("[buildFromSpecsMarkdown] Total SOPLang code length:", allSoplangCode.length, "characters");

        if (debug.isEnabled() && allSoplangCode.trim()) {
            debug.log("[buildFromSpecsMarkdown] ---------- CONCATENATED SOPLANG CODE ----------");
            // Show first 2000 chars or full code if shorter
            const preview = allSoplangCode.length > 2000
                ? allSoplangCode.substring(0, 2000) + "\n... (truncated)"
                : allSoplangCode;
            debug.log(preview);
            debug.log("[buildFromSpecsMarkdown] ---------- END SOPLANG CODE ----------");
        }

        if (!allSoplangCode.trim()) {
            debug.error("[buildFromSpecsMarkdown] No SOPLang code found in any markdown files!");
            throw new Error("No soplang code found in .specs markdown files");
        }

        // Create or update document with concatenated soplang code
        const docId = "specs-soplang-document";
        let docObj;
        try {
            docObj = await documents.getDocument(docId);
        } catch (_) {
            docObj = null;
        }

        const docTemplate = {
            docId,
            title: "Specs SOPLang Document",
            category: "specs",
            infoText: "Automatically generated document containing all SOPLang code from .specs markdown files",
            commands: allSoplangCode
        };

        if (!docObj) {
            await documents.createDocument(docId, "specs");
        }

        await documents.updateDocument(docId, docTemplate.title, docId, docTemplate.category, docTemplate.infoText, docTemplate.commands, {});
        debug.log("[buildFromSpecsMarkdown] Document updated:", docId);

        debug.log("[buildFromSpecsMarkdown] Saving workspace...");
        await workspace.forceSave();
        debug.log("[buildFromSpecsMarkdown] Workspace saved");

        debug.log("[buildFromSpecsMarkdown] Building all SOPLang code...");
        const buildResult = await workspace.buildAll();
        debug.log("[buildFromSpecsMarkdown] Build completed. Result:", buildResult);

        const durationMs = Date.now() - startedAt;
        const buildErrors = $$.getBuildErrors?.() || [];

        if (buildErrors.length > 0) {
            debug.error("[buildFromSpecsMarkdown] Build errors detected:", buildErrors.length);
            buildErrors.forEach((err, i) => debug.error(`  Error ${i + 1}:`, err));
        } else {
            debug.log("[buildFromSpecsMarkdown] ✓ No build errors");
        }

        debug.log("[buildFromSpecsMarkdown] ========== BUILD COMPLETE ==========");
        debug.log("[buildFromSpecsMarkdown] Duration:", durationMs, "ms");
        debug.log("[buildFromSpecsMarkdown] Files scanned:", files.length);
        debug.log("[buildFromSpecsMarkdown] SOPLang code length:", allSoplangCode.length);

        return {
            docId,
            soplangCodeLength: allSoplangCode.length,
            filesScanned: files.length,
            matrixCodeBlocks: matrixSoplangCode.length,
            otherCodeBlocks: soplangCodeBlocks.length,
            errors: buildErrors,
            durationMs
        };
    };

    return self;
}

let singletonInstance;

export async function getInstance() {
    if (!singletonInstance) {
        singletonInstance = await SoplangBuilder();
    }
    return singletonInstance;
}

export function getAllow() {
    return async () => true;
}

export function getDependencies() {
    return ["Workspace", "Documents"];
}
