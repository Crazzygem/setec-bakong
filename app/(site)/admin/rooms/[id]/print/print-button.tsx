"use client";

import { Button } from "@/components/ui";

export default function PrintButton() {
  return (
    <Button variant="secondary" size="sm" onClick={() => window.print()}>
      Print this sign
    </Button>
  );
}
