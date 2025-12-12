/**
 * Debug logger for SOPLang Builder.
 * Logs information only when ACHILLES_DEBUG=true or ACHILLES_DEBUG=1.
 * Writes logs to achilles-debug.log in current working directory.
 */

import fs from "node:fs";
import path from "node:path";

const isDebugEnabled = () => {
    const val = process.env.ACHILLES_DEBUG;
    return val === 'true' || val === '1';
};

const timestamp = () => new Date().toISOString();

const getLogFilePath = () => path.join(process.cwd(), 'achilles-debug.log');

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
    if (!isDebugEnabled()) return;

    const logFile = getLogFilePath();
    const message = `[${level} ${timestamp()}] ${formatArgs(args)}\n`;

    try {
        fs.appendFileSync(logFile, message, 'utf8');
    } catch (err) {
        // Fallback to console if file write fails
        console.error(`Failed to write to log file: ${err.message}`);
    }
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
    isEnabled: isDebugEnabled,
    getLogFilePath,
};

export default debug;
