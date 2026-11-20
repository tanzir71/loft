"use client";

import { useState } from "react";

import { renderMarkdown } from "@/lib/markdown";

type MarkdownEditorProps = {
  defaultValue?: string;
  id: string;
  label: string;
  name: string;
};

export function MarkdownEditor({ defaultValue = "", id, label, name }: MarkdownEditorProps) {
  const [value, setValue] = useState(defaultValue);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div>
        <label className="block text-sm font-medium" htmlFor={id}>
          {label}
        </label>
        <textarea
          className="mt-2 min-h-56 w-full rounded-xl border bg-background px-3 py-2 text-sm"
          id={id}
          name={name}
          onChange={(event) => setValue(event.target.value)}
          value={value}
        />
      </div>
      <div>
        <p className="text-sm font-medium">Live preview</p>
        <div
          aria-label={`${label} preview`}
          className="prose-sm mt-2 min-h-56 rounded-xl border bg-background p-4"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }}
        />
      </div>
    </div>
  );
}
