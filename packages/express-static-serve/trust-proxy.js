// Express treats `true` (and any huge number) as "trust every hop", which lets any visitor forge
// the client IP, and a numeric string such as "1" as "trust nothing" while looking configured.
// So TRUST_PROXY is parsed strictly into a Number of hops, and anything else stops the process.
const MAX_TRUSTED_HOPS = 10;
const HOPS_PATTERN = /^(0|[1-9][0-9]?)$/;

function parseTrustProxy(value) {
  if (value === undefined || value === "") {
    return 0;
  }
  if (HOPS_PATTERN.test(value) && Number(value) <= MAX_TRUSTED_HOPS) {
    return Number(value);
  }
  throw new Error(
    `Invalid TRUST_PROXY ${JSON.stringify(value)}: expected a whole number from 0 to ` +
      `${MAX_TRUSTED_HOPS}, or leave it unset for 0`
  );
}

module.exports = { parseTrustProxy, MAX_TRUSTED_HOPS };
