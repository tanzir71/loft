"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

type CopyTextButtonProps = {
  text: string;
};

export function CopyTextButton({ text }: CopyTextButtonProps) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }}
      type="button"
      variant="outline"
    >
      {copied ? "Copied" : "Copy reminder message"}
    </Button>
  );
}
