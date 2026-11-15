const helmet = require("helmet");

// The Content-Security-Policy the server sends. scripts/check-csp.js lints dist/ against this
// same object, so a change made here reaches both. These are Helmet's defaults.
const CSP_DIRECTIVES = helmet.contentSecurityPolicy.getDefaultDirectives();

// Browser features that pages in dist/ may not use, and may not hand to an iframe. Remove a
// name here to allow it for the site itself.
const DENIED_FEATURES = [
  "accelerometer",
  "browsing-topics",
  "camera",
  "display-capture",
  "geolocation",
  "gyroscope",
  "magnetometer",
  "microphone",
  "midi",
  "payment",
  "usb",
];
const PERMISSIONS_POLICY = DENIED_FEATURES.map((feature) => `${feature}=()`).join(", ");

function permissionsPolicy(req, res, next) {
  res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
  next();
}

// The whole "Helmet" stage of the middleware order, as one unit.
function securityHeaders() {
  return [helmet({ contentSecurityPolicy: { directives: CSP_DIRECTIVES } }), permissionsPolicy];
}

module.exports = { securityHeaders, CSP_DIRECTIVES, PERMISSIONS_POLICY };
