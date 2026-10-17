#!/usr/bin/env node
"use strict";

// Applies the hardening changes that touch the protected files (.claude/settings.json and
// .claude/hooks/*.sh). block-hook-edit.sh stops the agent from editing those, so you run this
// yourself:
//
//   node .claude/lib/apply-hardening.js --dry-run   # show what would change, write nothing
//   node .claude/lib/apply-hardening.js             # apply, then verify
//
// Every step is idempotent: running it again reports "already applied" and changes nothing. If a
// step's anchor text is not found (the file was edited by hand), the run fails loudly instead of
// guessing, and nothing is written. Review the result with `git diff .claude/`.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const CLAUDE_DIR = path.join(__dirname, "..");
const SETTINGS_PATH = path.join(CLAUDE_DIR, "settings.json");
const DRY_RUN = process.argv.includes("--dry-run");

// `npm audit*` also matches `npm audit fix --force`, which CLAUDE.md forbids. Allow only the
// read-only forms and deny the forced fix outright.
const BROAD_AUDIT_RULE = "Bash(npm audit*)";
const NARROW_AUDIT_RULES = ["Bash(npm audit)", "Bash(npm audit --*)"];
const FORCED_AUDIT_FIX_DENY = "Bash(npm audit fix*--force*)";

// No package.json defines a `lint` script, so this allow rule can never match a real command.
const STALE_LINT_RULE = "Bash(npm run lint*)";

// notification-alert.sh plays a macOS sound, which is a personal preference. It is registered in
// the git-ignored settings.local.json so that a clone of the repository does not inherit it.
const LOCAL_SETTINGS_PATH = path.join(CLAUDE_DIR, "settings.local.json");
const NOTIFICATION_HOOK_FILE = "notification-alert.sh";
const NOTIFICATION_ENTRY = {
  hooks: [
    {
      type: "command",
      command: `bash "$CLAUDE_PROJECT_DIR/.claude/hooks/${NOTIFICATION_HOOK_FILE}"`,
    },
  ],
};
const isNotificationEntry = (entry) =>
  (entry.hooks ?? []).some((hook) => String(hook.command).includes(NOTIFICATION_HOOK_FILE));

// The bash and python text below is built from plain strings, not template literals, because it
// contains "${...}" and backslashes.
const lines = (...parts) => parts.join("\n");

// ---------------------------------------------------------------------------------------------
// block-dangerous-git.sh
// ---------------------------------------------------------------------------------------------

// The original check matched "-f" and "main" as bare substrings, so a branch such as
// "feature-main-fix" or "maintenance-fix" was blocked as a force push. Match the flag and the
// branch name as whole words instead.
const FORCE_CHECK_ANCHOR = lines(
  `if printf '%s\\n' "$COMMAND" | grep -qE "git push.*(--force|-f).*(main|master)" ||`,
  `  printf '%s\\n' "$COMMAND" | grep -qE "git push.*(main|master).*(--force|-f)"; then`
);
const FORCE_CHECK_REPLACEMENT = lines(
  "FORCE_RE='[[:space:]](--force|-f)([^[:alnum:]]|$)'",
  "BRANCH_RE='[[:space:]:/](main|master)([^[:alnum:]_./-]|$)'",
  "# Checked separately, not as one regex, so the order of flag and branch does not matter.",
  `if printf '%s\\n' "$COMMAND" | grep -qE "git push" &&`,
  `  printf '%s\\n' "$COMMAND" | grep -qE "$FORCE_RE" &&`,
  `  printf '%s\\n' "$COMMAND" | grep -qE "$BRANCH_RE"; then`
);

// A '+' refspec force-pushes without --force, and --delete or a ':main' refspec removes the
// branch. Inserted before the `reset --hard` check.
const RESET_CHECK_ANCHOR = 'if printf \'%s\\n\' "$COMMAND" | grep -qE "git reset --hard"; then';
const PUSH_BLOCK = lines(
  "# A '+' refspec force-pushes without --force; --delete or a ':main' refspec removes",
  "# the branch.",
  "PROTECTED_PUSH_RES=(",
  '  "git push.*[[:space:]]\\+[^[:space:]]*(main|master)([^[:alnum:]_./-]|$)"',
  '  "git push.*[[:space:]](--delete|-d)[[:space:]].*(main|master)([^[:alnum:]_./-]|$)"',
  '  "git push.*[[:space:]]:(main|master)([^[:alnum:]_./-]|$)"',
  ")",
  'for re in "${PROTECTED_PUSH_RES[@]}"; do',
  '  if printf \'%s\\n\' "$COMMAND" | grep -qE "$re"; then',
  '    echo "BLOCKED: A + refspec push to, or deleting, main/master is not allowed." >&2',
  '    echo "Use a feature branch and open a PR instead." >&2',
  "    exit 2",
  "  fi",
  "done",
  "",
  ""
);

const GIT_PATCHES = [
  {
    name: "Match force-push flags and branch names as whole words",
    marker: "FORCE_RE=",
    anchor: FORCE_CHECK_ANCHOR,
    replacement: FORCE_CHECK_REPLACEMENT,
  },
  {
    name: "Block + refspec and delete pushes to main",
    marker: "PROTECTED_PUSH_RES=",
    anchor: RESET_CHECK_ANCHOR,
    replacement: PUSH_BLOCK + RESET_CHECK_ANCHOR,
  },
];

const GIT_CASES = [
  { command: "git push --force origin main", exit: 2 },
  { command: "git push -f origin master", exit: 2 },
  { command: "git push origin main --force", exit: 2 },
  { command: "git push --force-with-lease origin main", exit: 2 },
  { command: "git push origin HEAD:main -f", exit: 2 },
  { command: "git push origin +main", exit: 2 },
  { command: "git push origin +HEAD:master", exit: 2 },
  { command: "git push origin --delete main", exit: 2 },
  { command: "git push origin :main", exit: 2 },
  { command: "git push origin main", exit: 0 },
  { command: "git push -u origin feature-main-fix", exit: 0 },
  { command: "git push origin maintenance-fix", exit: 0 },
  { command: "git push --force origin feature-x", exit: 0 },
  { command: "git push origin +feature", exit: 0 },
  { command: "git reset --hard HEAD~1", exit: 2 },
  { command: "git status", exit: 0 },
];

// ---------------------------------------------------------------------------------------------
// block-rm-outside-repo.sh
// ---------------------------------------------------------------------------------------------

// The original treated every token after `rm` as an rm target, up to the end of the command, so
// `rm -f x; cp a /dev/null` was blocked because of `/dev/null`. Tokenise with shell punctuation
// split out (`;`, `&&`, `|`, `>` ...) and stop reading rm's arguments at the first one.
const RM_TOKENISE_ANCHOR = lines("try:", "    tokens = shlex.split(command)", "except ValueError:");
const RM_TOKENISE_REPLACEMENT = lines(
  "try:",
  "    lexer = shlex.shlex(command, posix=True, punctuation_chars=True)",
  "    lexer.whitespace_split = True",
  "    tokens = list(lexer)",
  "except ValueError:"
);
const RM_ARGS_ANCHOR = lines("    for tok in tokens[idx + 1:]:", "        if tok.startswith('-'):");
const RM_ARGS_REPLACEMENT = lines(
  "    for tok in tokens[idx + 1:]:",
  "        if set(tok) <= set('();<>|&'):",
  "            break",
  "        if tok.startswith('-'):"
);

const RM_PATCHES = [
  {
    name: "Tokenise rm commands with shell operators split out",
    marker: "punctuation_chars=True",
    anchor: RM_TOKENISE_ANCHOR,
    replacement: RM_TOKENISE_REPLACEMENT,
  },
  {
    name: "Stop reading rm targets at the next shell operator",
    marker: "set('();<>|&')",
    anchor: RM_ARGS_ANCHOR,
    replacement: RM_ARGS_REPLACEMENT,
  },
];

const RM_CASES = [
  { command: "rm -rf /tmp/foo", exit: 2 },
  { command: "sudo rm -rf /tmp/foo", exit: 2 },
  { command: "rm /tmp/foo && echo ok", exit: 2 },
  { command: "rm -rf /tmp/a; rm -rf /tmp/b", exit: 2 },
  { command: "rm -rf ../outside", exit: 2 },
  { command: "rm -rf ~/scratch", exit: 2 },
  { command: "rm -rf packages/express-static-serve/dist", exit: 0 },
  { command: "echo hi && rm -rf packages/express-static-serve/dist", exit: 0 },
  { command: "rm -rf .tmp-x; cp a /dev/null", exit: 0 },
  { command: "rm -rf .tmp-x && cp a /dev/null", exit: 0 },
  { command: "rm -rf .tmp-x | cat /etc/hosts", exit: 0 },
  { command: "rm -rf .tmp-x > /dev/null 2>&1", exit: 0 },
  { command: 'echo "rm -rf /tmp/foo"', exit: 0 },
];

// ---------------------------------------------------------------------------------------------
// block-hook-edit.sh
// ---------------------------------------------------------------------------------------------

// super-linter's shfmt check rejects the backslash-continued condition; `||` at the end of the
// line already continues a command in bash, so the backslashes and extra indent go. Behaviour
// is unchanged, and the cases below prove it.
const HOOK_EDIT_ANCHOR = lines(
  `if [[ "$FILE_PATH" == *"/.claude/settings.json" ]] || \\`,
  `   { [[ "$FILE_PATH" == *"/.claude/hooks/"* ]] && [[ "$FILE_PATH" == *.sh ]]; } || \\`,
  `   [[ "$FILE_PATH" == *"/.gemini/settings.json" ]] || \\`,
  `   { [[ "$FILE_PATH" == *"/.gemini/hooks/"* ]] && [[ "$FILE_PATH" == *.sh ]]; }; then`
);
const HOOK_EDIT_REPLACEMENT = lines(
  `if [[ "$FILE_PATH" == *"/.claude/settings.json" ]] ||`,
  `  { [[ "$FILE_PATH" == *"/.claude/hooks/"* ]] && [[ "$FILE_PATH" == *.sh ]]; } ||`,
  `  [[ "$FILE_PATH" == *"/.gemini/settings.json" ]] ||`,
  `  { [[ "$FILE_PATH" == *"/.gemini/hooks/"* ]] && [[ "$FILE_PATH" == *.sh ]]; }; then`
);

const HOOK_EDIT_PATCHES = [
  {
    name: "Format the protected-file condition the way shfmt expects",
    marker: lines(`]] ||`, `  { [[ "$FILE_PATH" == *"/.claude/hooks/"*`),
    anchor: HOOK_EDIT_ANCHOR,
    replacement: HOOK_EDIT_REPLACEMENT,
  },
];

// Edit/Write hooks receive a file path instead of a command.
const HOOK_EDIT_CASES = [
  { file_path: "/r/.claude/settings.json", exit: 2 },
  { file_path: "/r/.claude/hooks/anything.sh", exit: 2 },
  { file_path: "/r/.gemini/settings.json", exit: 2 },
  { file_path: "/r/.gemini/hooks/anything.sh", exit: 2 },
  { file_path: "/r/.claude/lib/hook-input.sh", exit: 0 },
  { file_path: "/r/.claude/hooks/README.md", exit: 0 },
  { file_path: "/r/packages/express-static-serve/server.js", exit: 0 },
];

// ---------------------------------------------------------------------------------------------
// warn-core-files.sh
// ---------------------------------------------------------------------------------------------

// For a PreToolUse hook that exits 0, Claude Code writes stdout and stderr to the debug log only:
// Claude never sees them, so these reminders were silently dropped. `additionalContext` in the
// hook's JSON output is delivered to Claude, and omitting `permissionDecision` leaves the normal
// permission flow untouched.
const WARN_ANCHOR = lines(
  `if [[ "$BASENAME" == "server.js" ]] && [[ "$FILE_PATH" == *"express-static-serve"* ]]; then`,
  `  echo "NOTICE: 'server.js' has a documented middleware-order invariant."`,
  `  echo "  - Required order: Helmet -> Morgan -> routes -> static files (see CLAUDE.md)."`,
  `  echo "  - Do not bypass security headers or introduce undocumented config changes."`,
  `  echo "  After editing, run: npm test (and start the server to confirm GET / returns UP)."`,
  `elif [[ "$BASENAME" == "ecosystem.config.js" ]] &&`,
  `  [[ "$FILE_PATH" == *"express-static-serve"* ]]; then`,
  `  echo "NOTICE: 'ecosystem.config.js' kill_timeout must exceed ` +
    `SHUTDOWN_TIMEOUT_MS in server.js."`,
  `  echo "  - Otherwise PM2 SIGKILLs workers that are still draining in-flight requests."`,
  `  echo "  After editing, run: npm test (test/ecosystem.test.js enforces this)."`,
  `fi`
);
const WARN_REPLACEMENT = lines(
  "# Claude never sees stdout or stderr from a PreToolUse hook that exits 0. Returning the",
  "# reminder as additionalContext puts it in front of Claude without changing the permission",
  "# decision.",
  "emit_notice() {",
  "  python3 -c '",
  "import json, sys",
  'text = "\\n".join(sys.argv[1:])',
  'output = {"hookEventName": "PreToolUse", "additionalContext": text}',
  'print(json.dumps({"hookSpecificOutput": output}))',
  '\' "$@"',
  "}",
  "",
  `if [[ "$BASENAME" == "server.js" ]] && [[ "$FILE_PATH" == *"express-static-serve"* ]]; then`,
  "  emit_notice \\",
  `    "NOTICE: 'server.js' has a documented middleware-order invariant." \\`,
  `    "  - Required order: Helmet -> Morgan -> routes -> static files (see CLAUDE.md)." \\`,
  `    "  - Do not bypass security headers or introduce undocumented config changes." \\`,
  `    "  After editing, run: npm test (and start the server to confirm GET / returns UP)."`,
  `elif [[ "$BASENAME" == "ecosystem.config.js" ]] &&`,
  `  [[ "$FILE_PATH" == *"express-static-serve"* ]]; then`,
  "  emit_notice \\",
  `    "NOTICE: 'ecosystem.config.js' kill_timeout must exceed ` +
    `SHUTDOWN_TIMEOUT_MS in server.js." \\`,
  `    "  - Otherwise PM2 SIGKILLs workers that are still draining in-flight requests." \\`,
  `    "  After editing, run: npm test (test/ecosystem.test.js enforces this)."`,
  `fi`
);

const WARN_PATCHES = [
  {
    name: "Deliver the reminders to Claude as additionalContext",
    marker: "emit_notice()",
    anchor: WARN_ANCHOR,
    replacement: WARN_REPLACEMENT,
  },
];

// `stdoutIncludes` expects JSON on stdout whose additionalContext contains the text;
// `stdoutEmpty` expects no stdout at all.
const WARN_CASES = [
  {
    file_path: "/r/packages/express-static-serve/server.js",
    exit: 0,
    stdoutIncludes: "middleware-order",
  },
  {
    file_path: "/r/packages/express-static-serve/ecosystem.config.js",
    exit: 0,
    stdoutIncludes: "kill_timeout",
  },
  { file_path: "/r/packages/express-static-serve/server.js.bak", exit: 0, stdoutEmpty: true },
  { file_path: "/r/other-package/server.js", exit: 0, stdoutEmpty: true },
  { file_path: "/r/README.md", exit: 0, stdoutEmpty: true },
];

const HOOKS = [
  { file: "block-dangerous-git.sh", patches: GIT_PATCHES, cases: GIT_CASES },
  { file: "block-rm-outside-repo.sh", patches: RM_PATCHES, cases: RM_CASES },
  { file: "block-hook-edit.sh", patches: HOOK_EDIT_PATCHES, cases: HOOK_EDIT_CASES },
  { file: "warn-core-files.sh", patches: WARN_PATCHES, cases: WARN_CASES },
];

// ---------------------------------------------------------------------------------------------

const hookPath = (file) => path.join(CLAUDE_DIR, "hooks", file);

// block-rm-outside-repo.sh resolves relative targets against the working directory, so the cases
// run from the repository root, as Claude Code does.
function repoRoot() {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: CLAUDE_DIR,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : process.cwd();
}

function applySettings(settings) {
  const results = [];
  const allow = settings.permissions.allow;
  const deny = settings.permissions.deny;

  const broadIndex = allow.indexOf(BROAD_AUDIT_RULE);
  const missingNarrow = NARROW_AUDIT_RULES.filter((rule) => !allow.includes(rule));
  if (broadIndex === -1 && missingNarrow.length === 0) {
    results.push(["Narrow the npm audit allow rule", "already applied"]);
  } else {
    // Replace in place so the surrounding order is kept; append if the broad rule is gone.
    const at = broadIndex === -1 ? allow.length : broadIndex;
    allow.splice(at, broadIndex === -1 ? 0 : 1, ...missingNarrow);
    results.push(["Narrow the npm audit allow rule", "applied"]);
  }

  if (deny.includes(FORCED_AUDIT_FIX_DENY)) {
    results.push(["Deny forced npm audit fix", "already applied"]);
  } else {
    deny.push(FORCED_AUDIT_FIX_DENY);
    results.push(["Deny forced npm audit fix", "applied"]);
  }

  const staleIndex = allow.indexOf(STALE_LINT_RULE);
  if (staleIndex === -1) {
    results.push(["Remove the allow rule for the missing lint script", "already applied"]);
  } else {
    allow.splice(staleIndex, 1);
    results.push(["Remove the allow rule for the missing lint script", "applied"]);
  }

  const notifications = settings.hooks?.Notification ?? [];
  if (!notifications.some(isNotificationEntry)) {
    results.push(["Unregister the personal sound hook from settings.json", "already applied"]);
  } else {
    const remaining = notifications.filter((entry) => !isNotificationEntry(entry));
    if (remaining.length > 0) {
      settings.hooks.Notification = remaining;
    } else {
      delete settings.hooks.Notification;
    }
    results.push(["Unregister the personal sound hook from settings.json", "applied"]);
  }
  return results;
}

// Registers the sound hook in settings.local.json, keeping everything already in that file.
// Returns the new file text, or null when the hook is already registered there.
function applyLocalSettings() {
  const local = fs.existsSync(LOCAL_SETTINGS_PATH)
    ? JSON.parse(fs.readFileSync(LOCAL_SETTINGS_PATH, "utf8"))
    : {};
  const notifications = local.hooks?.Notification ?? [];
  const name = "Register the sound hook in settings.local.json";
  if (notifications.some(isNotificationEntry)) {
    return { text: null, result: [name, "already applied"] };
  }
  local.hooks = { ...local.hooks, Notification: [...notifications, NOTIFICATION_ENTRY] };
  return { text: JSON.stringify(local, null, 2) + "\n", result: [name, "applied"] };
}

function applyHookPatches(file, original, patches) {
  let text = original;
  const results = [];
  for (const { name, marker, anchor, replacement } of patches) {
    if (text.includes(marker)) {
      results.push([`${file}: ${name}`, "already applied"]);
      continue;
    }
    if (!text.includes(anchor)) {
      throw new Error(
        `"${name}": anchor text not found in hooks/${file}. The hook was edited by hand; ` +
          "apply this change manually. Nothing was written."
      );
    }
    text = text.replace(anchor, () => replacement);
    results.push([`${file}: ${name}`, "applied"]);
  }
  return { text, results };
}

function runHook(file, toolInput, cwd) {
  const input = JSON.stringify({ tool_input: toolInput });
  const result = spawnSync("bash", [hookPath(file)], { input, encoding: "utf8", cwd });
  return { status: result.status, stdout: result.stdout ?? "" };
}

// Returns a failure description for a case's stdout expectations, or null when they hold.
function checkStdout(stdout, { stdoutIncludes, stdoutEmpty }) {
  if (stdoutEmpty && stdout.trim() !== "") {
    return `expected no stdout, got ${JSON.stringify(stdout.trim().slice(0, 60))}`;
  }
  if (stdoutIncludes === undefined) {
    return null;
  }
  let output;
  try {
    output = JSON.parse(stdout).hookSpecificOutput;
  } catch {
    return "stdout is not valid JSON";
  }
  if (output?.hookEventName !== "PreToolUse") {
    return "hookSpecificOutput.hookEventName is not PreToolUse";
  }
  if (output.permissionDecision !== undefined) {
    return "a reminder must not set permissionDecision";
  }
  return String(output.additionalContext).includes(stdoutIncludes)
    ? null
    : `additionalContext lacks "${stdoutIncludes}"`;
}

function verify() {
  const failures = [];
  const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  if (settings.permissions.allow.includes(BROAD_AUDIT_RULE)) {
    failures.push(`${BROAD_AUDIT_RULE} is still in permissions.allow`);
  }
  if (!settings.permissions.deny.includes(FORCED_AUDIT_FIX_DENY)) {
    failures.push(`${FORCED_AUDIT_FIX_DENY} is missing from permissions.deny`);
  }
  if (settings.permissions.allow.includes(STALE_LINT_RULE)) {
    failures.push(`${STALE_LINT_RULE} is still in permissions.allow`);
  }
  if ((settings.hooks?.Notification ?? []).some(isNotificationEntry)) {
    failures.push(`${NOTIFICATION_HOOK_FILE} is still registered in settings.json`);
  }
  const local = JSON.parse(fs.readFileSync(LOCAL_SETTINGS_PATH, "utf8"));
  if (!(local.hooks?.Notification ?? []).some(isNotificationEntry)) {
    failures.push(`${NOTIFICATION_HOOK_FILE} is not registered in settings.local.json`);
  }
  const cwd = repoRoot();
  let caseCount = 0;
  for (const { file, cases } of HOOKS) {
    for (const { exit, stdoutIncludes, stdoutEmpty, ...toolInput } of cases) {
      caseCount += 1;
      const { status, stdout } = runHook(file, toolInput, cwd);
      const subject = toolInput.command ?? toolInput.file_path;
      if (status !== exit) {
        failures.push(`${file}: "${subject}" exited ${status}, expected ${exit}`);
      }
      const problem = checkStdout(stdout, { stdoutIncludes, stdoutEmpty });
      if (problem) {
        failures.push(`${file}: "${subject}": ${problem}`);
      }
    }
  }
  return { failures, caseCount };
}

function main() {
  const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  const settingsResults = applySettings(settings);

  // Compute everything first so a failed anchor leaves every file untouched.
  const hookEdits = HOOKS.map(({ file, patches }) => {
    const before = fs.readFileSync(hookPath(file), "utf8");
    return { file, before, ...applyHookPatches(file, before, patches) };
  });

  const localSettings = applyLocalSettings();

  const allResults = [
    ...settingsResults,
    localSettings.result,
    ...hookEdits.flatMap((edit) => edit.results),
  ];
  for (const [name, status] of allResults) {
    console.log(`${status === "applied" ? "+" : "="} ${name}: ${status}`);
  }

  if (DRY_RUN) {
    console.log("\nDry run: nothing written, verification skipped.");
    return 0;
  }

  // Register locally before unregistering from the shared file, so a failure in between leaves
  // the hook registered somewhere rather than nowhere.
  if (localSettings.text !== null) {
    fs.writeFileSync(LOCAL_SETTINGS_PATH, localSettings.text);
  }
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
  for (const { file, before, text } of hookEdits) {
    if (text !== before) {
      fs.writeFileSync(hookPath(file), text);
    }
  }

  const { failures, caseCount } = verify();
  if (failures.length > 0) {
    console.error("\nVerification FAILED:");
    failures.forEach((failure) => console.error(`  - ${failure}`));
    return 1;
  }
  console.log(`\nVerified: settings rules and ${caseCount} hook cases pass.`);
  console.log("Review with: git diff .claude/");
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`apply-hardening failed: ${error.message}`);
  process.exitCode = 1;
}
