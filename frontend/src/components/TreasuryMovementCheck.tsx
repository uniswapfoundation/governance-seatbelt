import { ExternalLinkIcon } from 'lucide-react';
import { useState } from 'react';

// Token address mapping for logo lookups (checksummed addresses)
const TOKEN_ADDRESSES: Record<string, string> = {
  ETH: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  UNI: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
  USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  ARB: '0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1',
  OP: '0x4200000000000000000000000000000000000042',
  LINK: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
  AAVE: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
  CRV: '0xD533a949740bb3306d119CC777fa900bA034cd52',
  MKR: '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2',
  COMP: '0xc00e94Cb662C3520282E6f5717214004A7f26888',
  SNX: '0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F',
  YFI: '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e',
  SUSHI: '0x6B3595068778DD592e39A122f4f5a5cF09C90fE2',
  GRT: '0xc944E90C64B2c07662A292be6244BDf05Cda44a7',
  ENS: '0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72',
  LDO: '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32',
  RPL: '0xD33526068D116cE69F19A9ee46F0bd304F21A51f',
  FRAX: '0x853d955aCEf822Db058eb8505911ED77F175b99e',
  stETH: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
  cbETH: '0xBe9895146f7AF43049ca1c1AE358B0541Ea49704',
  rETH: '0xae78736Cd615f374D3085123A210448E74Fc6393',
};

// Get token logo URL from Trust Wallet assets or fallback
function getTokenLogoUrl(symbol: string): string | null {
  const address = TOKEN_ADDRESSES[symbol.toUpperCase()];
  if (!address) return null;

  // Special case for ETH
  if (symbol.toUpperCase() === 'ETH') {
    return 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png';
  }

  return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/${address}/logo.png`;
}

// Token logo component with fallback
function TokenLogo({ symbol }: { symbol: string }) {
  const [hasError, setHasError] = useState(false);
  const logoUrl = getTokenLogoUrl(symbol);

  if (!logoUrl || hasError) {
    // Fallback: show first letter in a circle
    return (
      <div className="w-4 h-4 rounded-full bg-muted flex items-center justify-center text-[9px] font-medium text-muted-foreground shrink-0">
        {symbol.charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={logoUrl}
      alt={symbol}
      width={16}
      height={16}
      className="w-4 h-4 rounded-full shrink-0"
      onError={() => setHasError(true)}
    />
  );
}

// Parse tokens from breakdown string like "UNI: 40,000,000 ($542,000,008), ETH: 1.5 ($3,000)"
interface ParsedToken {
  symbol: string;
  amount: string;
  usdValue: string;
}

function parseTokenBreakdown(breakdown: string): ParsedToken[] {
  const tokens: ParsedToken[] = [];
  // Match patterns like "UNI: 40,000,000 ($542,000,008)" or "uni: 100,000,000 ($542,000,008"
  // The closing paren may be cut off, so make it optional
  const tokenPattern = /([A-Za-z0-9]+):\s*([\d,.]+)\s*\(\$?([\d,]+(?:\.\d+)?)\)?/gi;
  const matches = breakdown.matchAll(tokenPattern);

  for (const match of matches) {
    tokens.push({
      symbol: match[1].toUpperCase(), // Normalize to uppercase for logo lookup
      amount: match[2],
      usdValue: `$${match[3]}`,
    });
  }

  return tokens;
}

interface TreasuryTransfer {
  recipient: string;
  tokenBreakdown: string;
  usdValue: string;
}

interface TreasuryMovementCheckProps {
  warnings: string[];
  treasuryAddresses: string[];
  transfers: TreasuryTransfer[];
  totalOutgoing: string;
  transferCount: number;
  thresholds: {
    total: string;
    perRecipient: string;
  };
}

// Format address for display (truncate middle)
function formatAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Format USD value for cleaner display
function formatUSD(value: string): string {
  const num = Number.parseFloat(value.replace(/[$,]/g, ''));
  if (Number.isNaN(num)) return value;

  if (num >= 1_000_000) {
    return `$${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `$${(num / 1_000).toFixed(0)}K`;
  }
  return `$${num.toFixed(0)}`;
}

// Format large numbers compactly (e.g., 40,000,000 -> 40M)
function formatCompactNumber(value: string): string {
  const num = Number.parseFloat(value.replace(/,/g, ''));
  if (Number.isNaN(num)) return value;

  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toFixed(2);
}

export function TreasuryMovementCheck({
  warnings,
  treasuryAddresses,
  transfers,
  totalOutgoing,
  transferCount,
  thresholds,
}: TreasuryMovementCheckProps) {
  const hasWarnings = warnings.length > 0;

  return (
    <div className="space-y-5">
      {/* Warnings */}
      {hasWarnings && (
        <div className="space-y-2">
          {warnings.map((warning) => (
            <div
              key={warning}
              className="px-3 py-2 rounded-md bg-amber-500/10 border-l-2 border-amber-500 text-sm text-amber-700 dark:text-amber-300"
            >
              {warning}
            </div>
          ))}
        </div>
      )}

      {/* Summary Stats */}
      <div className="flex gap-6">
        <div>
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-0.5">
            Total Outgoing
          </p>
          <p className="text-xl font-semibold tabular-nums tracking-tight">
            {formatUSD(totalOutgoing)}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-0.5">
            Transfers
          </p>
          <p className="text-xl font-semibold tabular-nums tracking-tight">{transferCount}</p>
        </div>
      </div>

      {/* Recipients Table */}
      {transfers.length > 0 && (
        <div>
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-2">
            Top Recipients
          </p>
          <div className="border border-border/60 rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground text-xs">
                    Address
                  </th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground text-xs">
                    Value
                  </th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground text-xs">
                    Tokens
                  </th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((transfer, idx) => {
                  const tokens = parseTokenBreakdown(transfer.tokenBreakdown);
                  return (
                    <tr
                      key={`${transfer.recipient}-${idx}`}
                      className="border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors"
                    >
                      <td className="py-2.5 px-3">
                        <a
                          href={`https://etherscan.io/address/${transfer.recipient}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 font-mono text-xs hover:text-primary transition-colors group"
                        >
                          {formatAddress(transfer.recipient)}
                          <ExternalLinkIcon className="h-3 w-3 opacity-0 group-hover:opacity-70 transition-opacity" />
                        </a>
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium tabular-nums">
                        {formatUSD(transfer.usdValue)}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {tokens.map((token, tokenIdx) => (
                            <div
                              key={`${token.symbol}-${tokenIdx}`}
                              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-muted/50 text-xs"
                            >
                              <TokenLogo symbol={token.symbol} />
                              <span className="font-medium">{token.symbol}</span>
                              <span className="text-muted-foreground tabular-nums">
                                {formatCompactNumber(token.amount)}
                              </span>
                            </div>
                          ))}
                          {tokens.length === 0 && (
                            <span className="text-muted-foreground text-xs">
                              {transfer.tokenBreakdown}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Treasury Sources & Thresholds */}
      <div className="flex flex-wrap items-start justify-between gap-4 pt-3 border-t border-border/40">
        <div>
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1.5">
            Treasury Sources
          </p>
          <div className="flex flex-wrap gap-1.5">
            {treasuryAddresses.map((address) => (
              <a
                key={address}
                href={`https://etherscan.io/address/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-muted/60 hover:bg-muted transition-colors text-[11px] font-mono"
              >
                {formatAddress(address)}
                <ExternalLinkIcon className="h-2.5 w-2.5 opacity-50" />
              </a>
            ))}
          </div>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">
            Thresholds
          </p>
          <p className="text-xs text-muted-foreground">
            {formatUSD(thresholds.total)} total / {formatUSD(thresholds.perRecipient)} per recipient
          </p>
        </div>
      </div>
    </div>
  );
}

// Parser function to extract treasury movement data from check details
export function parseTreasuryMovementDetails(details: string): {
  warnings: string[];
  treasuryAddresses: string[];
  transfers: TreasuryTransfer[];
  totalOutgoing: string;
  transferCount: number;
  thresholds: { total: string; perRecipient: string };
} | null {
  if (!details) return null;

  const result = {
    warnings: [] as string[],
    treasuryAddresses: [] as string[],
    transfers: [] as TreasuryTransfer[],
    totalOutgoing: '$0',
    transferCount: 0,
    thresholds: { total: '$1,000,000', perRecipient: '$250,000' },
  };

  // Split into lines for easier parsing
  const lines = details.split('\n');

  // Extract warnings (lines that mention threshold exceeded or warning patterns)
  for (const line of lines) {
    if (
      line.includes('exceeded threshold') ||
      (line.includes('received') && line.includes('from treasury'))
    ) {
      // Clean up the warning text - remove markdown backticks
      const cleanedWarning = line
        .replace(/`/g, '')
        .replace(/^[-•]\s*/, '')
        .trim();
      if (cleanedWarning) {
        result.warnings.push(cleanedWarning);
      }
    }
  }

  // Extract treasury addresses from "Treasury addresses considered:" section
  let inTreasurySection = false;
  for (const line of lines) {
    if (line.includes('Treasury addresses considered:')) {
      inTreasurySection = true;
      continue;
    }
    if (inTreasurySection) {
      if (line.includes('Outgoing') || line.includes('Warning') || line.trim() === '') {
        if (line.includes('Outgoing') || line.includes('Warning')) {
          inTreasurySection = false;
        }
        continue;
      }
      const addrMatch = line.match(/`?(0x[a-fA-F0-9]{40})`?/);
      if (addrMatch) {
        result.treasuryAddresses.push(addrMatch[1]);
      }
    }
  }

  // Extract total outgoing and transfer count
  // Format: "Outgoing transfers (excluding treasury-to-treasury): $542,000,008 across 1 transfers"
  const outgoingMatch = details.match(
    /Outgoing transfers[^:]*:\s*\$?([\d,]+(?:\.\d+)?)\s*across\s*(\d+)\s*transfers?/i,
  );
  if (outgoingMatch) {
    result.totalOutgoing = `$${outgoingMatch[1]}`;
    result.transferCount = Number.parseInt(outgoingMatch[2], 10);
  }

  // Extract thresholds
  // Format: "Warning thresholds: $1,000,000 total, $250,000 per recipient"
  const thresholdMatch = details.match(
    /thresholds?:\s*\$?([\d,]+(?:\.\d+)?)\s*total,\s*\$?([\d,]+(?:\.\d+)?)\s*per/i,
  );
  if (thresholdMatch) {
    result.thresholds.total = `$${thresholdMatch[1]}`;
    result.thresholds.perRecipient = `$${thresholdMatch[2]}`;
  }

  // Extract top recipients
  // Format: "• `0x...`: $542,000,008 (UNI: 40,000,000 ($542,000,008))"
  let inRecipientsSection = false;
  for (const line of lines) {
    if (line.includes('Top recipients by USD')) {
      inRecipientsSection = true;
      continue;
    }
    if (inRecipientsSection && line.trim()) {
      // Match: `address`: $amount (token breakdown)
      const recipientMatch = line.match(
        /[•-]\s*`?(0x[a-fA-F0-9]{40})`?:\s*\$?([\d,]+(?:\.\d+)?)\s*\(([^)]+)\)/,
      );
      if (recipientMatch) {
        result.transfers.push({
          recipient: recipientMatch[1],
          usdValue: `$${recipientMatch[2]}`,
          tokenBreakdown: recipientMatch[3],
        });
      }
    }
  }

  return result;
}
