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
    },
  ],
};
