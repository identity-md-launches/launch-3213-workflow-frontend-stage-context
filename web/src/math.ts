import { formatUnits, parseUnits } from "viem";
export const Q96 = 1n << 96n;
export function amount(value: string, decimals: number) {
  if (!/^\d+(\.\d*)?$/.test(value) || value.split(".")[1]?.length > decimals)
    throw Error(
      `Enter a positive amount with up to ${decimals} decimal places.`,
    );
  const n = parseUnits(value, decimals);
  if (n <= 0n) throw Error("Enter an amount greater than zero.");
  return n;
}
export function checkedAmount(
  value: string,
  decimals: number,
  balance: bigint | undefined,
  unit: string,
) {
  const n = amount(value, decimals);
  if (balance === undefined)
    throw Error("Balance is unavailable. Refresh before continuing.");
  if (n > balance)
    throw Error(
      `This amount exceeds the available ${unit} balance. Choose a smaller amount or use Max.`,
    );
  return n;
}
export function units(n?: bigint, decimals = 18, digits = 4) {
  if (n === undefined) return "Unavailable";
  const absolute = n < 0n ? -n : n,
    scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = (absolute % scale)
    .toString()
    .padStart(decimals, "0")
    .slice(0, digits)
    .replace(/0+$/, "");
  if (absolute > 0n && whole === 0n && !fraction) {
    const bound = digits ? `0.${"0".repeat(digits - 1)}1` : "1";
    return n < 0n ? `> -${bound}` : `<${bound}`;
  }
  const grouped = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(whole);
  return `${n < 0n ? "-" : ""}${grouped}${fraction ? "." + fraction : ""}`;
}
export const exact = (n: bigint, decimals = 18) => formatUnits(n, decimals);
export function slippage(value: string) {
  const n = Number(value);
  if (
    !Number.isFinite(n) ||
    n < 0 ||
    n > 50 ||
    !/^\d+(\.\d{1,2})?$/.test(value)
  )
    throw Error(
      "Set slippage between 0 and 50%, with up to two decimal places.",
    );
  return BigInt(Math.round(n * 100));
}
export const minimum = (n: bigint, bps: bigint) =>
  (n * (10000n - bps)) / 10000n;
export function priceFromSqrt(
  sqrt: bigint,
  notIs0: boolean,
  assetDecimals: number,
) {
  const ratio = (Number(sqrt) / Number(Q96)) ** 2;
  return (notIs0 ? ratio : 1 / ratio) * 10 ** (18 - assetDecimals);
}
export function sqrtFromPrice(
  price: string,
  notIs0: boolean,
  assetDecimals: number,
) {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0)
    throw Error("Enter a price greater than zero.");
  const raw = p / 10 ** (18 - assetDecimals);
  const sqrt = BigInt(
    Math.floor(Math.sqrt(notIs0 ? raw : 1 / raw) * Number(Q96)),
  );
  if (
    sqrt <= 4295128739n ||
    sqrt >= 1461446703485210103287273052203988822378723970342n
  )
    throw Error("Price is outside the supported pool range.");
  return sqrt;
}
export function rangeTicks(
  from: string,
  to: string,
  notIs0: boolean,
  decimals: number,
  spacing: number,
) {
  const lo = Number(from),
    hi = Number(to);
  if (!(lo > 0 && hi > lo) || !Number.isInteger(spacing) || spacing <= 0)
    throw Error("Choose a positive range with To greater than From.");
  const raw = (p: number) =>
    Math.log(
      notIs0 ? p / 10 ** (18 - decimals) : 1 / (p / 10 ** (18 - decimals)),
    ) / Math.log(1.0001);
  const a = raw(lo),
    b = raw(hi);
  const lower = Math.floor(Math.min(a, b) / spacing) * spacing,
    upper = Math.ceil(Math.max(a, b) / spacing) * spacing;
  if (lower < -887272 || upper > 887272 || lower >= upper)
    throw Error("Range is outside supported ticks.");
  return [lower, upper] as const;
}
export function sqrtAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || Math.abs(tick) > 887272)
    throw Error("Invalid tick");
  const factors = [
    "fffcb933bd6fad37aa2d162d1a594001",
    "fff97272373d413259a46990580e213a",
    "fff2e50f5f656932ef12357cf3c7fdcc",
    "ffe5caca7e10e4e61c3624eaa0941cd0",
    "ffcb9843d60f6159c9db58835c926644",
    "ff973b41fa98c081472e6896dfb254c0",
    "ff2ea16466c96a3843ec78b326b52861",
    "fe5dee046a99a2a811c461f1969c3053",
    "fcbe86c7900a88aedcffc83b479aa3a4",
    "f987a7253ac413176f2b074cf7815e54",
    "f3392b0822b70005940c7a398e4b70f3",
    "e7159475a2c29b7443b29c7fa6e889d9",
    "d097f3bdfd2022b8845ad8f792aa5825",
    "a9f746462d870fdf8a65dc1f90e061e5",
    "70d869a156d2a1b890bb3df62baf32f7",
    "31be135f97d08fd981231505542fcfa6",
    "9aa508b5b7a84e1c677de54f3e99bc9",
    "5d6af8dedb81196699c329225ee604",
    "2216e584f5fa1ea926041bedfe98",
    "48a170391f7dc42444e8fa2",
  ];
  let r = 1n << 128n;
  const a = Math.abs(tick);
  for (let i = 0; i < factors.length; i++)
    if (a & (1 << i)) r = (r * BigInt("0x" + factors[i])) / (1n << 128n);
  if (tick > 0) r = ((1n << 256n) - 1n) / r;
  return r / (1n << 32n) + (r % (1n << 32n) ? 1n : 0n);
}
export function liquidityAmounts(
  sqrt: bigint,
  lower: number,
  upper: number,
  liq: bigint,
) {
  const a = sqrtAtTick(lower),
    b = sqrtAtTick(upper);
  const p = sqrt < a ? a : sqrt > b ? b : sqrt;
  return [((liq << 96n) * (b - p)) / b / p, (liq * (p - a)) / Q96] as const;
}
export const proposalStates = [
  "Voting",
  "Failed",
  "Passed · veto window",
  "Passed · executable",
  "Expired",
  "Vetoed",
  "Executed",
];
export const proposalKinds = [
  "Open position",
  "Add asset",
  "Add venue",
  "Add bridge",
  "Bridge out",
];
export const canPropose = (staked: bigint, total: bigint, operator: boolean) =>
  operator || (staked > 0n && staked * 10000n >= total * 10n);
export const bootstrapActive = (end: bigint, time: bigint) =>
  end > 0n && time < end;
