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
    payload = JSON.parse(rawInput);
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

const pluginsDir = path.join(toolDir, 'plugins');

if (!fs.existsSync(pluginsDir)) {
    console.error(`Plugins directory not found at ${pluginsDir}`);
    process.exit(1);
}

const pluginFiles = fs.readdirSync(pluginsDir)
    .filter(file => file.endsWith('.js'))
    .map(file => path.join(pluginsDir, file));

if (pluginFiles.length === 0) {
    console.error(`No plugin files found in ${pluginsDir}`);
    process.exit(1);
}

const pluginModules = {};

for (const pluginFile of pluginFiles) {
    try {
        const pluginModule = await loadPluginModule(pluginFile);
        const name = path.basename(pluginFile, '.js');
        pluginModules[name] = pluginModule;
    } catch (error) {
        console.error(`Error loading plugin from ${pluginFile}: ${error.message}`);
    }
}

const graph = await buildDependencyGraph(pluginModules);
const sortedPlugins = topologicalSort(graph);

for (const name of sortedPlugins) {
    const pluginModule = pluginModules[name];
    const pluginFile = path.join(pluginsDir, `${name}.js`);

    if (!fs.existsSync(pluginFile)) {
        console.warn(`Plugin file not found for ${name}`);
        continue;
    }

    try {
        await registerPlugin(name, pluginModule);
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
    console.log(JSON.stringify(result ?? null));
} catch (err) {
    console.error(`Error executing ${pluginName}.${methodName}: ${err.message}`);
    process.exit(1);
}
NODE
