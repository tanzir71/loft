"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

type CopyTextButtonProps = {
  copiedLabel?: string;
  label?: string;
  text: string;
};

export function CopyTextButton({
  copiedLabel = "Copied",
  label = "Copy reminder message",
  text,
}: CopyTextButtonProps) {
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
      {copied ? copiedLabel : label}
    </Button>
  );
}
