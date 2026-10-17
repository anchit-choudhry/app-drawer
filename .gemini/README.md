# Gemini Configuration

This directory contains Gemini-specific configurations and references to project-wide invariants.

## Single Source of Truth

To ensure information is maintained in one location, most Gemini-specific files refer to their
counterparts in the `.claude/` directory.

### Mirrors and References

- **Agents:** See [.gemini/agents/](agents/express-security-reviewer.md)
  (Mirrors [.claude/agents/](../.claude/agents/))
- **Skills:** See [.gemini/skills/](skills/dependency-update/SKILL.md)
  (Mirrors [.claude/skills/](../.claude/skills/))
- **Hooks:** See [.gemini/hooks/](hooks/README.md) (References [.claude/hooks/](../.claude/hooks/))

## Project Guidance

Foundational guidance for all AI agents is maintained in the root [GEMINI.md](../GEMINI.md).
