import util from "util";
import config from "../config.js";

const LEVELS = ["error", "warn", "info", "debug"];
const resolvedIndex = LEVELS.indexOf(config.logLevel);
const currentLevelIndex = resolvedIndex === -1 ? LEVELS.indexOf("info") : resolvedIndex;

function format(level, args) {
  const timestamp = new Date().toISOString();
  const message = util.format(...args);
  return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
}

function log(level, ...args) {
  const levelIndex = LEVELS.indexOf(level);
  if (levelIndex === -1) return;
  if (levelIndex > currentLevelIndex) return;

  if (level === "error") {
    console.error(format(level, args));
  } else if (level === "warn") {
    console.warn(format(level, args));
  } else {
    console.log(format(level, args));
  }
}

export const logger = {
  error: (...args) => log("error", ...args),
  warn: (...args) => log("warn", ...args),
  info: (...args) => log("info", ...args),
  http: (...args) => log("info", ...args),
  debug: (...args) => log("debug", ...args),
};

export default logger;
