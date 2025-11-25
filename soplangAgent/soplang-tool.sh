#!/bin/sh

# Read JSON payload from stdin (expects pluginName, methodName, params)
payload="$(cat)"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export SOPLANG_TOOL_DIR="${SCRIPT_DIR}"
export SOPLANG_TOOL_PAYLOAD="${payload}"

node --input-type=module <<'NODE'
import fs from 'fs';
import path from 'path';
import {pathToFileURL} from 'url';

const toolDir = process.env.SOPLANG_TOOL_DIR;
const rawInput = process.env.SOPLANG_TOOL_PAYLOAD || '';

if (!toolDir) {
    console.error('SOPLANG_TOOL_DIR is not set.');
    process.exit(1);
}

if (!rawInput.trim()) {
    console.error('No input received. Provide JSON via stdin with pluginName, methodName and params.');
    process.exit(1);
}

if (typeof globalThis.$$ === 'undefined') {
    globalThis.$$ = {};
}

if (typeof globalThis.$$.throwError === 'undefined') {
    globalThis.$$.throwError = async function throwError(error, ...args) {
        if (typeof error === 'string') {
            error = new Error(error + ' ' + args.join(' '));
        }
        throw error;
    };
}

if (typeof globalThis.$$.throwAsyncError === 'undefined') {
    globalThis.$$.throwAsyncError = async function throwAsyncError(error, ...args) {
        return $$.throwError(error, ...args);
    };
}

const plugins = {};
let loadOrder = [];

const loadPluginModule = async (pluginPath) => {
    try {
        return await import(pathToFileURL(pluginPath));
    } catch (e) {
        throw new Error(`Cannot load plugin module at path ${pluginPath}: ${e.message}`);
    }
};

const registerPlugin = async (pluginName, pluginModule) => {
    if (!pluginModule) {
        throw new Error(`Module at path for plugin ${pluginName} does not export anything`);
    }
    if (typeof pluginModule.getInstance !== 'function') {
        throw new Error(`Module for ${pluginName} does not export a function called getInstance`);
    }
    if (typeof pluginModule.getAllow !== 'function') {
        throw new Error(`Module for ${pluginName} does not export a function called getAllow`);
    }

    const plugin = await pluginModule.getInstance();
    plugin.allow = await pluginModule.getAllow();
    if (!plugin) {
        throw new Error(`Module for plugin ${pluginName} did not return a plugin instance`);
    }

    if (plugins[pluginName]) {
        throw new Error(`Plugin ${pluginName} already registered`);
    }

    plugins[pluginName] = plugin;
    loadOrder.push(pluginName);

    if (pluginName === 'StandardPersistence' && !plugins['DefaultPersistence']) {
        plugins['DefaultPersistence'] = plugin;
    }
};

const buildDependencyGraph = async (pluginModules) => {
    const graph = {};

    Object.keys(pluginModules).forEach(pluginName => {
        graph[pluginName] = [];
    });

    const results = await Promise.all(Object.keys(pluginModules).map(async (pluginName) => {
        const pluginModule = pluginModules[pluginName];
        let dependencies = [];
        if (typeof pluginModule.getDependencies === 'function') {
            dependencies = await pluginModule.getDependencies();
        }
        return {pluginName, dependencies: dependencies || []};
    }));

    results.forEach(result => {
        result.dependencies.forEach(dep => {
            if (!graph[result.pluginName]) {
                graph[result.pluginName] = [];
            }
            graph[result.pluginName].push(dep);
        });
    });

    return graph;
};

const topologicalSort = (graph) => {
    const visited = {};
    const temp = {};
    const order = [];

    Object.keys(graph).forEach(node => {
        visited[node] = false;
        temp[node] = false;
    });

    const visit = (node) => {
        if (temp[node]) {
            throw new Error(`Circular dependency detected involving plugin ${node}`);
        }

        if (visited[node]) {
            return;
        }

        temp[node] = true;

        if (graph[node] && Array.isArray(graph[node])) {
            graph[node].forEach(dependency => {
                visit(dependency);
            });
        }

        temp[node] = false;
        visited[node] = true;

        order.push(node);
    };

    Object.keys(graph).forEach(node => {
        if (!visited[node]) {
            visit(node);
        }
    });

    return order;
};

$$.registerPlugin = async (pluginName, pluginPath) => {
    const resolvedPath = path.isAbsolute(pluginPath) ? pluginPath : path.resolve(toolDir, pluginPath);
    const pluginModule = await loadPluginModule(resolvedPath);
    return registerPlugin(pluginName, pluginModule);
};

$$.loadPlugin = (pluginName) => {
    return plugins[pluginName];
};

await import(pathToFileURL(path.join(toolDir, 'src', 'util', 'debugUtil.js'))).catch(() => {});

let payload;
try {
    let parsed = JSON.parse(rawInput);
    payload = parsed.input;
} catch (err) {
    console.error(`Invalid JSON input: ${err.message}`);
    process.exit(1);
}

const {pluginName, methodName, params = []} = payload;

if (!pluginName || typeof pluginName !== 'string') {
    console.error('"pluginName" must be a non-empty string.');
    process.exit(1);
}
if (!methodName || typeof methodName !== 'string') {
    console.error('"methodName" must be a non-empty string.');
    process.exit(1);
}
if (!Array.isArray(params)) {
    console.error('"params" must be an array.');
    process.exit(1);
}

const pluginsDir = path.join(toolDir,'node_modules','soplang','plugins');

if (!fs.existsSync(pluginsDir)) {
    console.error(`Plugins directory not found at ${pluginsDir}`);
    process.exit(1);
}

const manualPlugins = [
    {name: 'DefaultPersistence', file: 'StandardPersistence.js'},
    {name: 'Workspace', file: 'Workspace.js'},
    {name: 'Agent', file: 'Agent.js'},
    {name: 'WorkspaceUser', file: 'WorkspaceUser.js'},
    {name: 'Documents', file: 'Documents.js'},
    {name: 'Table', file: 'Table.js'},
    {name: 'LLM', file: 'LLM.js'},
    {name: 'ChatRoom', file: 'ChatRoom.js'},
];

for (const {name, file} of manualPlugins) {
    const pluginFile = path.join(pluginsDir, file);
    if (!fs.existsSync(pluginFile)) {
        console.warn(`Plugin file not found for ${name} at ${pluginFile}`);
        continue;
    }
    try {
        await $$.registerPlugin(name, pluginFile);
        console.error(`Registered plugin: ${name}`);
    } catch (error) {
        console.error(`Error registering plugin ${name}: ${error.message}`);
    }
}

const targetPlugin = plugins[pluginName];
if (!targetPlugin) {
    console.error(`Plugin ${pluginName} not found`);
    process.exit(1);
}

if (typeof targetPlugin.allow === 'function') {
    const canExecute = await targetPlugin.allow(undefined, undefined, methodName, ...params);
    if (canExecute === false) {
        console.error(`Not allowed to execute ${pluginName}.${methodName}`);
        process.exit(1);
    }
}

if (typeof targetPlugin[methodName] !== 'function') {
    console.error(`The plugin ${pluginName} does not implement the "${methodName}" method`);
    process.exit(1);
}

try {
    const result = await targetPlugin[methodName].call(targetPlugin, ...params);
    process.stdout.write(JSON.stringify(result));
} catch (err) {
    console.error(`Error executing ${pluginName}.${methodName}: ${err.message}`);
    process.exit(1);
}
NODE
