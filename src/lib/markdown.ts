function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeHref(value: string) {
  try {
    const url = new URL(value, "https://tutorloft.local");
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

function inlineMarkdown(value: string) {
  return escapeHtml(value)
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, (_match, label: string, href: string) => {
      const normalizedHref = href.trim();

      if (!safeHref(normalizedHref)) {
        return label;
      }

      return `<a class="text-primary underline" href="${escapeHtml(normalizedHref)}" rel="noreferrer" target="_blank">${label}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

export function renderMarkdown(markdown: string) {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const html: string[] = [];
  let listOpen = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      if (listOpen) {
        html.push("</ul>");
        listOpen = false;
      }
      continue;
    }

    const listItem = /^[-*]\s+(.+)$/.exec(trimmed);

    if (listItem) {
      if (!listOpen) {
        html.push('<ul class="list-disc space-y-1 pl-5">');
        listOpen = true;
      }
      html.push(`<li>${inlineMarkdown(listItem[1])}</li>`);
      continue;
    }

    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }

    if (trimmed.startsWith("### ")) {
      html.push(`<h3 class="mt-4 text-base font-semibold">${inlineMarkdown(trimmed.slice(4))}</h3>`);
    } else if (trimmed.startsWith("## ")) {
      html.push(`<h2 class="mt-5 text-lg font-semibold">${inlineMarkdown(trimmed.slice(3))}</h2>`);
    } else if (trimmed.startsWith("# ")) {
      html.push(`<h1 class="mt-6 font-display text-2xl italic">${inlineMarkdown(trimmed.slice(2))}</h1>`);
    } else {
      html.push(`<p class="mt-3 text-sm leading-6">${inlineMarkdown(trimmed)}</p>`);
    }
  }

  if (listOpen) {
    html.push("</ul>");
  }

  return html.join("\n");
}
