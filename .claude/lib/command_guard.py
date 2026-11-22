#!/usr/bin/env python3
"""Command analysis for the PreToolUse guard hooks in .claude/hooks/.

Usage: command_guard.py <mode> <argument> [<repo root>]

  git-commit <command>            exit 2 when the command would create a commit
  git-danger <command>            exit 2 for a force push to main or master, a mirror push, a
                                  delete of main or master, reset --hard, clean -f, branch -D
  rm <command> <repo root>        exit 2 when rm, rmdir, unlink, shred, or find -delete can reach
                                  a path outside the repository (or a path it cannot resolve)
  path <path>                     exit 2 when the path is a security-enforcement file

A guardrail for an assistant that makes mistakes or follows injected text, not a sandbox: a
command that is assembled at run time (base64, a script file, a variable that holds a command)
cannot be read here, and the permission prompt stays the control for those. What it does read:
separators (; && || | & newlines), `bash -c`, `sh -c`, `eval`, `$(...)` and backticks, wrapper
commands in front of git or rm (env, sudo, xargs, command), git's global options (-C, -c, ...),
and a `cd` earlier in the same command. A command it cannot parse falls back to a cruder split
instead of passing, and any error here exits 2, so a broken guard blocks instead of allowing.
"""

import os
import re
import shlex
import sys

MAX_DEPTH = 6
SEPARATORS = set(";&|()<>\n")
SHELLS = {"bash", "sh", "zsh", "dash", "ksh"}
REMOVERS = {"rm", "rmdir", "unlink", "shred"}
FIND_EXEC = {"-exec", "-execdir", "-ok", "-okdir"}
GIT_OPTIONS_WITH_ARGUMENT = {
    "-C",
    "-c",
    "--git-dir",
    "--work-tree",
    "--namespace",
    "--exec-path",
    "--super-prefix",
    "--config-env",
    "--attr-source",
}
COMMIT_SUBCOMMANDS = {"commit", "commit-tree"}
PROTECTED_BRANCHES = {"main", "master"}
PROTECTED_DIRECTORIES = ("/.claude/hooks/", "/.claude/lib/", "/.gemini/hooks/")
PROTECTED_FILES = (
    "/.claude/settings.json",
    "/.claude/settings.local.json",
    "/.gemini/settings.json",
)


class Blocked(Exception):
    """Raised with the lines to show when a command must not run."""

    def __init__(self, *lines):
        super().__init__(lines[0])
        self.lines = lines


# ---------------------------------------------------------------------------------------------
# Reading a command line
# ---------------------------------------------------------------------------------------------


def naive_segments(command):
    """A crude split, used when the command has an unbalanced quote (for example an apostrophe in
    a comment or a here-document). Quotes become spaces, so nothing is skipped."""
    cleaned = command.replace('"', " ").replace("'", " ").replace("`", " ")
    segments = []
    for part in re.split(r"[;&|()<>\n]+", cleaned):
        tokens = part.split()
        if tokens:
            segments.append(tokens)
    return segments


ANSI_C_QUOTE = re.compile(r"\$'((?:[^'\\]|\\.)*)'", re.DOTALL)


def decode_ansi_c(match):
    """$'comm\\x69t' is the word `commit`; shlex reads it as the text $commit instead."""
    inner = match.group(1)
    try:
        inner = inner.encode("utf-8").decode("unicode_escape")
    except (UnicodeDecodeError, ValueError):
        pass
    return shlex.quote(inner)


def normalize_backticks(command):
    """Rewrites $'...' as the word it spells, and each `...` pair as $(...), so that a
    substitution with spaces in it is read as commands, in order, like any other. An unpaired
    backtick is left alone."""
    command = ANSI_C_QUOTE.sub(decode_ansi_c, command)
    parts = []
    i = 0
    while i < len(command):
        if command[i] == "`":
            end = command.find("`", i + 1)
            if end != -1:
                parts.append("$(" + command[i + 1 : end] + ")")
                i = end + 1
                continue
        parts.append(command[i])
        i += 1
    return "".join(parts)


def split_segments(command):
    """The simple commands in a command line, each as a list of words."""
    command = normalize_backticks(command)
    try:
        lexer = shlex.shlex(command, posix=True, punctuation_chars=";&|()<>\n")
        lexer.whitespace = " \t\r"
        lexer.whitespace_split = True
        lexer.commenters = ""
        tokens = list(lexer)
    except ValueError:
        return naive_segments(command)
    segments = []
    current = []
    for token in tokens:
        if token and set(token) <= SEPARATORS:
            if current:
                segments.append(current)
                current = []
        else:
            current.append(token)
    if current:
        segments.append(current)
    return segments


def substitutions(text):
    """Command substitutions inside one word: $(...) and backticks."""
    found = []
    i = 0
    while i < len(text):
        if text.startswith("$(", i):
            depth = 1
            j = i + 2
            while j < len(text) and depth:
                if text[j] == "(":
                    depth += 1
                elif text[j] == ")":
                    depth -= 1
                j += 1
            found.append(text[i + 2 : j - 1 if depth == 0 else j])
            i = j
        elif text[i] == "`":
            end = text.find("`", i + 1)
            if end == -1:
                found.append(text[i + 1 :])
                break
            found.append(text[i + 1 : end])
            i = end + 1
        else:
            i += 1
    return found


def nested_commands(argv):
    """Command lines hidden inside one simple command: `bash -c "..."`, `eval ...`, `$(...)`."""
    inner = []
    for index, word in enumerate(argv):
        if os.path.basename(word) in SHELLS:
            for j in range(index + 1, len(argv)):
                flag = argv[j]
                if flag.startswith("-") and not flag.startswith("--") and "c" in flag[1:]:
                    if j + 1 < len(argv):
                        inner.append(argv[j + 1])
                    break
        if word == "eval" and index + 1 < len(argv):
            inner.append(" ".join(argv[index + 1 :]))
        inner.extend(substitutions(word))
    return inner


def walk(command, cwd, visit, depth=0):
    """Calls visit(argv, cwd) for every simple command, nested ones included, in order. visit
    returns the working directory for the commands after it."""
    if depth > MAX_DEPTH:
        raise Blocked("BLOCKED: this command is nested too deeply to check.")
    for argv in split_segments(command):
        cwd = visit(argv, cwd)
        for inner in nested_commands(argv):
            walk(inner, cwd, visit, depth + 1)
    return cwd


# ---------------------------------------------------------------------------------------------
# git
# ---------------------------------------------------------------------------------------------


def git_calls(argv):
    """Every git invocation in a simple command, as (subcommand, arguments, -c settings). A git
    behind a wrapper (sudo, env, xargs, command) counts, because any word named git does.
    """
    for index, word in enumerate(argv):
        if os.path.basename(word) != "git":
            continue
        args = argv[index + 1 :]
        settings = []
        j = 0
        while j < len(args):
            option = args[j]
            if option in GIT_OPTIONS_WITH_ARGUMENT:
                if option in ("-c", "--config-env") and j + 1 < len(args):
                    settings.append(args[j + 1])
                j += 2
                continue
            if option.startswith("-"):
                j += 1
                continue
            break
        if j < len(args):
            yield args[j], args[j + 1 :], settings
        else:
            yield None, [], settings


def aliases(settings):
    """alias.<name>=<value> settings given with -c, as {name: first word of the value}."""
    found = {}
    for setting in settings:
        key, _, value = setting.partition("=")
        if key.lower().startswith("alias.") and value.split():
            found[key[len("alias.") :]] = value.split()[0].lstrip("!")
    return found


def letters(arguments):
    """The letters of every short-option cluster (-fdx gives f, d, x)."""
    found = set()
    for argument in arguments:
        if argument.startswith("-") and not argument.startswith("--") and len(argument) > 1:
            found.update(argument[1:])
    return found


def is_protected_ref(ref):
    """True when a push refspec ends at main or master (`+main`, `HEAD:refs/heads/main`)."""
    target = ref.lstrip("+")
    if ":" in target:
        target = target.split(":")[-1]
    target = target.removeprefix("refs/heads/")
    return target in PROTECTED_BRANCHES


def push_problem(args):
    """Why a git push must not run, as a sentence, or None when it may."""
    flags = []
    positional = []
    after_options = False
    for argument in args:
        if argument == "--" and not after_options:
            after_options = True
        elif argument.startswith("-") and not after_options:
            flags.append(argument)
        else:
            positional.append(argument)
    short = letters(flags)
    force = (
        any(f in ("--force", "--force-if-includes") for f in flags)
        or any(f.startswith("--force-with-lease") for f in flags)
        or "f" in short
    )
    delete = "--delete" in flags or "d" in short
    refspecs = positional[1:]
    problems = (
        (
            "--mirror" in flags,
            "git push --mirror overwrites every remote branch, main and master included.",
        ),
        (force and "--all" in flags, "A force push of --all includes main and master."),
        (
            force and not refspecs,
            "A force push with no branch named goes to the current branch, which may be main.",
        ),
        (
            force and any(is_protected_ref(r) or r in ("HEAD", "@") for r in refspecs),
            "Force push to main/master (or to the current branch, which may be main).",
        ),
        (
            any(r.startswith("+") and is_protected_ref(r) for r in refspecs),
            "A + refspec force-pushes to main/master.",
        ),
        (
            delete and any(is_protected_ref(r) for r in refspecs),
            "Deleting main/master on the remote.",
        ),
        (
            any(r.startswith(":") and is_protected_ref(r) for r in refspecs),
            "A :main refspec deletes main/master on the remote.",
        ),
    )
    return next((message for found, message in problems if found), None)


def danger_problem(sub, args):
    """The two lines to show when a git subcommand is destructive, or None."""
    if sub == "push":
        problem = push_problem(args)
        if problem:
            return (
                "BLOCKED: " + problem,
                "Use a feature branch and open a PR instead.",
            )
    if sub == "reset" and "--hard" in args:
        return (
            "BLOCKED: 'git reset --hard' discards uncommitted changes permanently.",
            "Use 'git stash' to save work first, or confirm this is intentional.",
        )
    if sub == "clean":
        short = letters(args)
        force = "f" in short or "--force" in args
        dry_run = "n" in short or "--dry-run" in args
        if force and not dry_run:
            return (
                "BLOCKED: 'git clean -f' permanently deletes untracked files.",
                "Run 'git clean -n' first to preview what would be deleted.",
            )
    if sub == "branch":
        short = letters(args)
        delete = "d" in short or "D" in short or "--delete" in args
        force = "f" in short or "D" in short or "--force" in args
        if delete and force:
            return (
                "BLOCKED: 'git branch -D' force-deletes a branch without merge check.",
                "Use 'git branch -d' (lowercase) for a safe delete, or confirm intentional.",
            )
    return None


def check_git_commit(command):
    """Raises Blocked when any git invocation in the command would create a commit."""

    def visit(argv, cwd):
        for sub, _args, settings in git_calls(argv):
            known = aliases(settings)
            resolved = known.get(sub, sub) if sub else sub
            if resolved in COMMIT_SUBCOMMANDS:
                raise Blocked(
                    "BLOCKED: git commit is not allowed from this session.",
                    "The user manages all commits themselves - see the Commit safety rule in "
                    "AGENTS.md.",
                    "Stage changes if asked, but leave committing to the user.",
                    "Offending command: " + command,
                )
        return cwd

    walk(command, os.getcwd(), visit)


def check_git_danger(command):
    """Raises Blocked when any git invocation in the command is destructive."""

    def visit(argv, cwd):
        for sub, args, _settings in git_calls(argv):
            problem = danger_problem(sub, args)
            if problem:
                raise Blocked(*problem, "Offending command: " + command)
        return cwd

    walk(command, os.getcwd(), visit)


# ---------------------------------------------------------------------------------------------
# rm
# ---------------------------------------------------------------------------------------------


def resolve(word, cwd):
    """The real path a word names, or None when it cannot be known (an unset variable, a
    substitution, or a relative path after a cd that could not be followed)."""
    expanded = os.path.expandvars(os.path.expanduser(word))
    if "$" in expanded or "`" in expanded:
        return None
    if not os.path.isabs(expanded):
        if cwd is None:
            return None
        expanded = os.path.join(cwd, expanded)
    return os.path.realpath(expanded)


def inside(path, root):
    """True when a resolved path is the root or below it."""
    return path == root or path.startswith(root + os.sep)


def after_cd(argv, cwd):
    """The working directory after `cd` or `pushd`, or None when it cannot be followed."""
    if argv[0] not in ("cd", "pushd"):
        return cwd
    targets = [a for a in argv[1:] if not a.startswith("-") or a == "-"]
    if not targets:
        return os.path.realpath(os.path.expanduser("~"))
    if targets[0] == "-":
        return None
    return resolve(targets[0], cwd)


def find_targets(argv, index):
    """The starting points of a find that deletes: the words after `find` up to its first
    expression. `.` when there are none."""
    j = index + 1
    while j < len(argv) and (argv[j] in ("-H", "-L", "-P") or argv[j].startswith(("-O", "-D"))):
        j += 1
    paths = []
    while j < len(argv) and not argv[j].startswith("-") and argv[j] not in ("!", "(", "\\("):
        paths.append(argv[j])
        j += 1
    return paths or ["."]


def removal_targets(argv):
    """Words that a simple command would delete: (word, ...) for rm and its relatives and for
    find -delete or find -exec rm."""
    targets = []
    for index, word in enumerate(argv):
        name = os.path.basename(word)
        if name in REMOVERS:
            ended_options = False
            for argument in argv[index + 1 :]:
                if argument == "--" and not ended_options:
                    ended_options = True
                elif argument.startswith("-") and not ended_options:
                    continue
                else:
                    targets.append(argument)
        elif name == "find":
            rest = argv[index + 1 :]
            deletes = "-delete" in rest or any(
                a in FIND_EXEC and i + 1 < len(rest) and os.path.basename(rest[i + 1]) in REMOVERS
                for i, a in enumerate(rest)
            )
            if deletes:
                targets.extend(find_targets(argv, index))
    return targets


def check_rm(command, repo_root):
    """Raises Blocked when a removal can reach outside the repository or cannot be resolved."""
    root = os.path.realpath(repo_root)
    offenders = []

    def visit(argv, cwd):
        for word in removal_targets(argv):
            target = resolve(word, cwd)
            if target is None:
                offenders.append((word, "cannot be resolved (variable, substitution, or cd)"))
            elif not inside(target, root):
                offenders.append((word, target))
        return after_cd(argv, cwd)

    walk(command, os.getcwd(), visit)
    if offenders:
        lines = ["BLOCKED: rm target resolves outside the project directory (" + root + ")."]
        lines += ["  '" + word + "' -> " + target for word, target in offenders]
        lines.append("Offending command: " + command)
        raise Blocked(*lines)


# ---------------------------------------------------------------------------------------------
# Protected files
# ---------------------------------------------------------------------------------------------


def check_path(path):
    """Raises Blocked when the path is a settings file, a hook, or a hook library."""
    # Lower case, because the default macOS file system treats .Claude/Settings.json as the
    # same file, and resolved, so ".." and symbolic links cannot hide the real location.
    resolved = os.path.realpath(os.path.abspath(path)).lower()
    if any(part in resolved for part in PROTECTED_DIRECTORIES) or resolved.endswith(
        PROTECTED_FILES
    ):
        raise Blocked(
            "BLOCKED: '" + path + "' is a security-enforcement file.",
            "Edit/Write on settings files, hooks, and the hook libraries is not allowed.",
            "Describe the exact change needed; the user must apply it themselves.",
        )


# ---------------------------------------------------------------------------------------------


def main(argv):
    """Runs one mode and returns the exit status: 0 to allow, 2 to block."""
    if len(argv) < 3:
        print("usage: command_guard.py <mode> <argument> [<repo root>]", file=sys.stderr)
        return 2
    mode, argument = argv[1], argv[2]
    try:
        if mode == "git-commit":
            check_git_commit(argument)
        elif mode == "git-danger":
            check_git_danger(argument)
        elif mode == "rm":
            if len(argv) < 4:
                print("usage: command_guard.py rm <command> <repo root>", file=sys.stderr)
                return 2
            check_rm(argument, argv[3])
        elif mode == "path":
            check_path(argument)
        else:
            print("unknown mode: " + mode, file=sys.stderr)
            return 2
    except Blocked as blocked:
        print("\n".join(blocked.lines), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv))
    except SystemExit:
        raise
    # A broken guard must block, not allow, so every failure is caught on purpose.
    except BaseException as error:  # noqa: BLE001  pylint: disable=broad-exception-caught
        print(
            "BLOCKED: the command guard failed (" + repr(error) + "); it fails closed.",
            file=sys.stderr,
        )
        sys.exit(2)
