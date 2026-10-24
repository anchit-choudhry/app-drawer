const { parseTrustProxy } = require("./trust-proxy");

// Validated when PM2 loads this file, so a bad TRUST_PROXY stops `pm2 start` in the terminal
// instead of surfacing as workers that crash in a restart loop.
const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);

module.exports = {
  apps: [
    {
      name: "express-static-serve",
      script: "server.js",
      cwd: __dirname,
      exec_mode: "cluster",
      instances: 0,
      time: true,
      // Must stay above SHUTDOWN_TIMEOUT_MS in server.js so PM2 does not SIGKILL a
      // worker that is still draining in-flight requests.
      kill_timeout: 12000,
      // Removes the Object.prototype.__proto__ accessor, which closes a common route to
      // prototype pollution. Do not add --permission here: it breaks PM2 cluster workers
      // (see test/ecosystem.test.js).
      node_args: ["--disable-proto=delete"],
      // Production mode also overrides a stray NODE_ENV=development exported by the launching
      // shell, which would otherwise put error messages and stacks on the 500 page.
      env: {
        NODE_ENV: "production",
        TRUST_PROXY: String(trustProxy),
      },
    },
  ],
};
