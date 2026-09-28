import { CallGroupedView } from '@/components/CallGroupedView';
import { FormattedCheckDetails } from '@/components/structured-report/FormattedCheckDetails';
import { notFound } from 'next/navigation';

export default async function CallFixturesPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  const { fixtureProposal, fixtureReport, fixtureCheck } = await import('./fixtures');

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Call UI stress fixture</h1>
        <p className="text-muted-foreground">
          Synthetic data for layout checks. No simulation or transaction.
        </p>
        <p className="text-sm text-muted-foreground">
          Resize to 320px, 390px, or desktop. Check long names, named arguments, nested payloads,
          repeated targets, tiny ETH values, warnings, and destination failures. Expand Technical
          details and test keyboard and copy controls.
        </p>
      </header>
      <section aria-labelledby="calls-title" className="space-y-4">
        <h2 id="calls-title" className="text-lg font-semibold">
          Calls
        </h2>
        <CallGroupedView proposal={fixtureProposal} report={fixtureReport} />
      </section>
      <section aria-labelledby="check-title" className="space-y-4">
        <h2 id="check-title" className="text-lg font-semibold">
          Calldata check
        </h2>
        <FormattedCheckDetails check={fixtureCheck} metadata={fixtureReport.metadata} />
      </section>
    </div>
  );
}
