import { Card } from "./card";

export function StatTile({ label, value, sub, id }: { label: string; value: string | number; sub?: string; id?: string }) {
  return (
    <Card className="scroll-mt-20 p-4" id={id}>
      <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">{label}</div>
      <div className="mt-1.5 font-display text-[26px] leading-none text-ink">{value}</div>
      {sub && <div className="mt-1.5 text-[12px] text-muted-2">{sub}</div>}
    </Card>
  );
}
