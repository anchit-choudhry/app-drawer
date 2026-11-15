const { parseTrustProxy } = require("../trust-proxy");

// The forced exit in server.js fires this long after a shutdown signal. kill_timeout in
// ecosystem.config.js must stay above it (test/ecosystem.test.js).
const SHUTDOWN_TIMEOUT_MS = 10000;
// What Node uses when the timeouts are not set (test/config.test.js compares them with Node).
const NODE_KEEP_ALIVE_TIMEOUT_MS = 5000;
const NODE_HEADERS_TIMEOUT_MS = 60000;
const WHOLE_NUMBER = /^(0|[1-9][0-9]*)$/;

const isUnset = (value) => value === undefined || value === "";

function invalid(name, value, expected) {
  return new Error(`Invalid ${name} ${JSON.stringify(value)}: expected ${expected}`);
}

// A whole number from min to max, or `fallback` when unset. Signs, decimals, exponents,
// spaces, and leading zeros are rejected, so a typo is never read as another value.
function wholeNumber(name, { min, max, fallback }) {
  return (value) => {
    if (isUnset(value)) {
      return fallback;
    }
    if (WHOLE_NUMBER.test(value) && Number(value) >= min && Number(value) <= max) {
      return Number(value);
    }
    throw invalid(name, value, `a whole number from ${min} to ${max}`);
  };
}

function oneOf(name, choices, fallback) {
  return (value) => {
    if (isUnset(value)) {
      return fallback;
    }
    if (choices.includes(value)) {
      return value;
    }
    throw invalid(name, value, `one of: ${choices.join(", ")}`);
  };
}

function flag(name, fallback) {
  const parse = oneOf(name, ["true", "false"], String(fallback));
  return (value) => parse(value) === "true";
}

// Every variable the server reads, in the order the README table lists them. NODE_ENV is
// not here: it is free-form, and only the exact value "development" changes anything.
const VARIABLES = {
  PORT: ["port", wholeNumber("PORT", { min: 0, max: 65535, fallback: 3000 })],
  TRUST_PROXY: ["trustProxy", parseTrustProxy],
  VERIFY_DIST_ON_START: ["verifyDistOnStart", flag("VERIFY_DIST_ON_START", false)],
  LOG_FORMAT: ["logFormat", oneOf("LOG_FORMAT", ["combined", "json"], "combined")],
  LOG_HEALTH_CHECKS: ["logHealthChecks", flag("LOG_HEALTH_CHECKS", true)],
  KEEP_ALIVE_TIMEOUT_MS: [
    "keepAliveTimeoutMs",
    wholeNumber("KEEP_ALIVE_TIMEOUT_MS", { min: 1000, max: 300000, fallback: undefined }),
  ],
  HEADERS_TIMEOUT_MS: [
    "headersTimeoutMs",
    wholeNumber("HEADERS_TIMEOUT_MS", { min: 1000, max: 600000, fallback: undefined }),
  ],
  SHUTDOWN_GRACE_MS: [
    "shutdownGraceMs",
    wholeNumber("SHUTDOWN_GRACE_MS", { min: 0, max: SHUTDOWN_TIMEOUT_MS - 1000, fallback: 0 }),
  ],
};

// Behind a load balancer the headers timeout is kept above the keep-alive timeout. A timeout
// that is not set counts as Node's default, so setting only a long keep-alive is refused.
function checkTimeouts({ keepAliveTimeoutMs, headersTimeoutMs }) {
  if (keepAliveTimeoutMs === undefined && headersTimeoutMs === undefined) {
    return;
  }
  const keepAlive = keepAliveTimeoutMs ?? NODE_KEEP_ALIVE_TIMEOUT_MS;
  const headers = headersTimeoutMs ?? NODE_HEADERS_TIMEOUT_MS;
  if (headers <= keepAlive) {
    throw new Error(
      `Invalid timeouts: HEADERS_TIMEOUT_MS (${headers}) must be greater than ` +
        `KEEP_ALIVE_TIMEOUT_MS (${keepAlive}); one that is not set counts as Node's default`
    );
  }
}

// Throws on the first bad value. Nothing falls back silently.
function loadConfig(env = process.env) {
  const config = {};
  for (const [name, [key, parse]] of Object.entries(VARIABLES)) {
    config[key] = parse(env[name]);
  }
  checkTimeouts(config);
  return Object.freeze(config);
}

// The PM2 env block: every variable as a string, "" when it has no value. A reload from the
// ecosystem file applies only that block, so a variable that is no longer exported goes back
// to its default, or to "" when it has none.
function toEnv(config) {
  return Object.fromEntries(
    Object.entries(VARIABLES).map(([name, [key]]) => [
      name,
      config[key] === undefined ? "" : String(config[key]),
    ])
  );
}

module.exports = {
  loadConfig,
  toEnv,
  ENV_NAMES: Object.keys(VARIABLES),
  SHUTDOWN_TIMEOUT_MS,
  NODE_KEEP_ALIVE_TIMEOUT_MS,
  NODE_HEADERS_TIMEOUT_MS,
};
