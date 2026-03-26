/**
 * Debug logger for SOPLang Builder.
 * Logs information only when ACHILLES_DEBUG=true or ACHILLES_DEBUG=1.
 * Writes logs to achilles-debug-<PID>.log in a debuglogs/ subdirectory.
 * Each process gets its own file — no cross-process contention or locking needed.
 */

import fs from "node:fs";
import path from "node:path";

const DEBUG_ENV = String(process.env.ACHILLES_DEBUG ?? '').toLowerCase();
const DEBUG_ENABLED = DEBUG_ENV === 'true' || DEBUG_ENV === '1';

let stream = null;
let initialised = false;

const getLogsDir = () => path.resolve(process.cwd(), 'debuglogs');

const getLogFilePath = () => path.join(getLogsDir(), `achilles-debug-${process.pid}.log`);

function ensureStream() {
    if (!DEBUG_ENABLED) return null;
    if (initialised) return stream;
    initialised = true;

    const logsDir = getLogsDir();
    try {
        fs.mkdirSync(logsDir, { recursive: true });
    } catch (err) {
        console.warn(`[debugLogger] Failed to create ${logsDir}: ${err.message}`);
        return null;
    }

    try {
        stream = fs.createWriteStream(getLogFilePath(), { flags: 'a', encoding: 'utf8' });
        stream.on('error', (err) => {
            console.warn(`[debugLogger] Stream error: ${err.message}`);
            stream = null;
        });
    } catch (err) {
        console.warn(`[debugLogger] Failed to open log file: ${err.message}`);
        return null;
    }
    return stream;
}

const timestamp = () => new Date().toISOString();

const formatArgs = (args) => {
    return args.map(arg => {
        if (arg === undefined) return 'undefined';
        if (arg === null) return 'null';
        if (typeof arg === 'object') {
            try {
                return JSON.stringify(arg, null, 2);
            } catch {
                return String(arg);
            }
        }
        return String(arg);
    }).join(' ');
};

const writeToFile = (level, args) => {
    if (!DEBUG_ENABLED) return;

    const s = ensureStream();
    if (!s) return;

    const message = `[${level} ${timestamp()}] ${formatArgs(args)}\n`;
    s.write(message);
};

export const debug = {
    log: (...args) => {
        writeToFile('DEBUG', args);
    },
    info: (...args) => {
        writeToFile('INFO', args);
    },
    warn: (...args) => {
        writeToFile('WARN', args);
    },
    error: (...args) => {
        writeToFile('ERROR', args);
    },
    group: (label) => {
        writeToFile('GROUP', [`>>> ${label}`]);
    },
    groupEnd: () => {
        writeToFile('GROUP', ['<<<']);
    },
    isEnabled: () => DEBUG_ENABLED,
    getLogFilePath,
};

export default debug;
