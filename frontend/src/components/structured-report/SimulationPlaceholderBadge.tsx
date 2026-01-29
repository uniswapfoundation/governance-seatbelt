import { Badge } from '@/components/ui/badge';

export function SimulationPlaceholderBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={`bg-slate-100 text-slate-600 border-slate-300 text-xs ${className || ''}`}
    >
      Simulation Placeholder
    </Badge>
  );
}
