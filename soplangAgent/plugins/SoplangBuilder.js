import fs from "node:fs/promises";
import path from "node:path";

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
    const self = {};
    const workspace = $$.loadPlugin("Workspace");
    const documents = $$.loadPlugin("Documents");
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
