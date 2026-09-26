import Link from "next/link";
import { Hexagon } from "lucide-react";

export function Brand({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link className="brand" href={href} aria-label="SmartHoneyAI home">
      <span className="brand-mark" aria-hidden="true"><Hexagon size={19} /></span>
      {!compact && <span className="brand-text">SmartHoney<span>AI</span></span>}
    </Link>
  );
}
