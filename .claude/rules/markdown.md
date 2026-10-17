---
paths:
  - "**/*.md"
---

# Markdown Style Rules

Source: Google Markdown Style Guide (google.github.io/styleguide/docguide/style.html). Applied to
all `.md` files in this project.

---

## Document Layout

Every document follows this structure:

```markdown
# Document Title

Short introduction (1-3 sentences).

## First Topic

Content.

## See also

- https://link-to-more-info
```

Rules:

- One `# H1` only - the document title; matches or approximates the filename
- 1-3 sentence intro immediately after the title
- All subsequent headings start at `##`
- Put miscellaneous links in a `## See also` section at the bottom

**`[TOC]` directive:** Do not use in this project. GitHub renders its own collapsible table of
contents in the sidebar automatically. The `[TOC]` directive only works on platforms like Gitiles
and produces nothing on GitHub.

---

## Headings

**Use ATX-style only** (`#` prefix). Never use `===` or `---` as heading underlines:

```markdown
# Good heading

Bad heading      <- DO NOT DO THIS
-----------
```

Note: a standalone `---` line (no text above it) is a **thematic break** (horizontal rule), not a
heading underline - that is valid and used throughout this project as a visual section separator.

**Add a blank line before and after every heading**, and a space after `#`:

```markdown
...previous text.

## My Heading

Next text...
```

**Use unique, fully descriptive heading names** - even subsections. Anchor links are auto-generated
from heading text, so vague names (`### Summary`, `### Example`) produce ambiguous anchors. Prefer:

```markdown
## Foo

### Foo summary

### Foo example
```

**Single H1 per document.** All subsequent headings are H2 or deeper.

**Capitalization:** Sentence case for headings (capitalize first word and proper nouns only).
Preserve original capitalization for product/tool names (e.g. `Express`, `Node.js`, `PM2`).

---

## Character Line Limit

Wrap prose at **100 characters**.

Exceptions (allowed to exceed 100 chars):

- URLs and Markdown links (the link portion only - wrap surrounding text normally)
- Table rows
- Headings
- Code blocks

---

## Trailing Whitespace

**Never** leave trailing whitespace. Do not use two trailing spaces for line breaks. Use a trailing
backslash (`\`) sparingly when a hard line break is truly needed:

```markdown
First line.\
Second line on a new line.
```

Prefer two newlines (a paragraph break) over any forced line break.

---

## Lists

**Numbered lists - use lazy numbering for long or frequently-changing lists:**

```markdown
1. First item.
1. Second item.
1. Third item.
```

For short, stable lists, use sequential numbers (easier to read in source):

```markdown
1. First item.
2. Second item.
3. Third item.
```

**Nested list indentation - 2 spaces per bullet level, aligned to the parent text for numbers.**
This matches the repo's markdownlint config (`.github/linters/.markdown-lint.yml`, MD007):

```markdown
1. Top-level item.
   Wrapped continuation aligns with the item text (3 spaces).
2. Next item.

- Bullet item.
  Wrapped continuation aligns with the item text (2 spaces).
  - Nested bullet, indented 2 spaces from its parent.
```

For small, non-nested, single-line lists, one space after the marker is fine:

```markdown
- Foo
- Bar
- Baz
```

---

## Code

**Inline code** - backticks for: commands, field names, file types, short code snippets:

```markdown
Run `npm test` before committing.
Update your `README.md`.
Pay attention to the `userId` field.
```

**Use backtick spans to escape** paths or URLs that should not be auto-linked:

```markdown
An example path: `packages/express-static-serve/server.js`
```

**Fenced code blocks** for anything longer than one line. Always declare the language:

```javascript
const port = process.env.PORT;
```

Never use 4-space-indented code blocks - they are ambiguous and unsearchable.

**Escape newlines** in shell commands intended for copy-paste:

```shell
npm run test:coverage \
  --workspace=express-static-serve
```

**Nest code blocks inside lists** with proper indentation so the list is not broken:

```markdown
- Step one.

    ```bash
    npm ci
    ```

- Step two.
```

---

## Links

**Use explicit paths** for internal Markdown links; omit the full qualified URL:

```markdown
See the [README](README.md).
```

**Use informative link titles.** Never use "here", "link", or a bare URL as title text:

```markdown
# Bad

See the docs [here](ROADMAP.md).

# Good

See the [roadmap](ROADMAP.md) for planned work.
```

**Reference links** for long URLs or repeated links - improves source readability and keeps table
cells short:

```markdown
See the [dist contract][dist-doc] for details.

[dist-doc]: README.md#providing-dist
```

Place reference link definitions just before the next heading (end of the section where they are
first used). If a reference is used across multiple sections, define it at the bottom of the
document.

---

## Images

Use images sparingly. Prefer plain text. When an image is necessary:

- Use it when showing a UI is clearer than describing it.
- Always provide descriptive alt text: `![Alt text describing the image](path/to/img.png)`

---

## Tables

Use tables only for **tabular data** with uniform distribution across two dimensions and multiple
parallel items with distinct attributes.

Prefer a list + subheadings when:

- Some columns are empty in many rows.
- The row/column ratio is unbalanced.
- Cells contain rambling prose.

Use **reference links in table cells** to keep line lengths manageable:

```markdown
| Transport | Favored by | Advantages               |
| --------- | ---------- | ------------------------ |
| Swallow   | Coconuts   | [Fast when unladen][spd] |

[spd]: path/to/airspeed-docs.md
```

---

## HTML

**Do not use HTML in Markdown files.** Every HTML element reduces readability and portability.
Standard Markdown syntax covers almost all cases.

If something feels impossible in Markdown, reconsider whether it is actually needed.

---

## Project-Specific Overrides

These rules take precedence over the Google style guide:

- **No en-dashes or em-dashes** (`-` only; never `--` typographic dash).
- **No PII** in any file (no email addresses, phone numbers, addresses).

**YAML frontmatter** (`.claude/` skill and agent files only): files may open with a
`---` frontmatter block before the first heading. This is not standard Markdown prose but is
required by the Claude Code skill/agent format:

```markdown
---
name: my-skill
description: What it does.
disable-model-invocation: true
---

# Skill Title
```
