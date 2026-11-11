const messages: Record<string, string> = {
  PriceMoved:
    "The pool price moved by more than 0.5%. Refresh the price and preview again.",
  MinTooLow:
    "Minimum deposits must be at least 99.5% of the quoted amounts. Refresh the preview.",
  BelowMinimum:
    "The position could not meet your minimum amounts. Refresh the preview or review slippage.",
  BelowMinOut:
    "The swap could not meet your minimum output. Request a fresh quote.",
  NotRegistered:
    "Launch registration is incomplete. Check launch setup before continuing.",
  AboveFree:
    "This amount exceeds the desk’s free balance. Use Max or enter a smaller amount.",
  AboveBasket:
    "This amount exceeds the selected basket. Use Max or enter a smaller amount.",
  AboveBucket:
    "This amount exceeds the vault buyback bucket. Use Max or enter a smaller amount.",
  AboveStaked:
    "This amount exceeds your staked NOTSTOCK. Use Max or enter a smaller amount.",
  BelowThreshold: "Stake at least 0.1% of all staked NOTSTOCK to propose.",
  BootstrapOver:
    "The bootstrap has ended. Propose a new position through governance.",
  NotOperator: "Connect the desk’s current operator wallet for this action.",
  NotExecutable: "This proposal is not executable. Refresh its voting status.",
  NoWeight: "You had no staked voting weight at this proposal’s checkpoint.",
  AlreadyVoted: "This wallet has already voted on this proposal.",
  KindOpen:
    "There is already an open proposal of this kind. Finish it before proposing another.",
  NeedsNotstock:
    "This range needs NOTSTOCK. Top-ups must use only the position’s asset. Choose a different range.",
  NothingTaken:
    "This range cannot use the entered amount. Review the range and balance.",
  ModuleMissing: "A required module has not been deployed. Open launch setup.",
  NotBridgeUnit: "Bridge amounts must be in increments of 0.000001 NOTSTOCK.",
  WrongAdapter:
    "This adapter does not match NOTSTOCK. Check the bridge address.",
};
export function errorText(error: unknown): string {
  const e = error as {
    code?: number;
    name?: string;
    message?: string;
    shortMessage?: string;
    data?: { errorName?: string };
    cause?: unknown;
  };
  if (
    e?.code === 4001 ||
    e?.name === "UserRejectedRequestError" ||
    /user rejected|user denied/i.test(e?.message ?? "")
  )
    return "Request rejected in your wallet. You can try again.";
  if (e?.code === 4902)
    return "Base is missing from your wallet. Use Switch to Base to add it.";
  if (e?.data?.errorName && messages[e.data.errorName])
    return messages[e.data.errorName];
  for (const [name, message] of Object.entries(messages))
    if ((e?.message ?? "").includes(name)) return message;
  if (e?.cause) {
    const nested = errorText(e.cause);
    if (
      nested !==
      "Unable to complete this request. Check your connection and try again."
    )
      return nested;
  }
  if (
    e instanceof Error &&
    !/0x[0-9a-f]{8}|ContractFunction|HTTP request|fetch|timeout|JSON-RPC/i.test(
      e.message,
    ) &&
    e.message.length < 240
  )
    return e.message;
  return "Unable to complete this request. Check your connection and try again.";
}
