/** Money is always integer cents. Currency is USD (handoff §2). */
export const CURRENCY = "USD";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: CURRENCY });
const usdWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: CURRENCY, maximumFractionDigits: 0, minimumFractionDigits: 0 });

export function assertCents(cents: number): void {
  if (!Number.isInteger(cents)) throw new Error(`Money must be integer cents, got ${cents}`);
}

/** 12345 → "$123.45"; whole dollars can drop the decimals: 12000 → "$120". */
export function formatUSD(cents: number, opts: { dropZeroCents?: boolean } = {}): string {
  assertCents(cents);
  if (opts.dropZeroCents && cents % 100 === 0) return usdWhole.format(cents / 100);
  return usd.format(cents / 100);
}

/** Parse user input like "120", "$1,250.5" or "40.00" into cents. Returns null when invalid. */
export function parseUSD(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole = "0", frac = ""] = cleaned.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return cleaned.startsWith("-") ? -cents : cents;
}

/** cents × minutes ÷ 60, rounded half-up to the cent (hourly rates). */
export function prorate(hourlyCents: number, minutes: number): number {
  assertCents(hourlyCents);
  return Math.round((hourlyCents * minutes) / 60);
}

/** Fill a payment link template: "https://pay.me/x?amount={amount}" → amount in dollars, 2 decimals. */
export function fillPaymentLink(template: string, cents: number, reference?: string): string {
  assertCents(cents);
  const amount = (cents / 100).toFixed(2);
  return template.replaceAll("{amount}", encodeURIComponent(amount)).replaceAll("{ref}", encodeURIComponent(reference ?? ""));
}
