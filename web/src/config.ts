import {
  createPublicClient,
  defineChain,
  fallback,
  http,
  keccak256,
  stringToHex,
  type Abi,
  type Address,
  type Chain,
  type Hex,
  parseAbi,
} from "viem";
import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors/injected";
import { coinbaseWallet } from "wagmi/connectors/coinbaseWallet";

export type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};
export type Deployment = {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: {
    name: string;
    address: Address;
    abiHash: string;
    abiPath: string;
  }[];
  assets: { path: string; sha256: string }[];
  poolKey: PoolKey;
  network: {
    chainId: number;
    name: string;
    testnet: boolean;
    rpcUrls: string[];
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    uniswapV4: {
      poolManager: Address;
      universalRouter: Address;
      quoter: Address;
      stateView: Address;
      positionManager: Address;
      permit2: Address;
      extendedSwapParams?: boolean;
    };
    pairToken: {
      address: Address;
      symbol: string;
      name: string;
      decimals: number;
    };
  };
  walletAddChain?: {
    chainId: Hex;
    chainName: string;
    rpcUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number };
    blockExplorerUrls: string[];
  };
};
export const same = (a?: string, b?: string) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const canonical = (x: unknown): unknown =>
  Array.isArray(x)
    ? x.map(canonical)
    : x && typeof x === "object"
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, canonical((x as Record<string, unknown>)[k])]),
        )
      : x;
export const hashAbi = (abi: Abi) =>
  keccak256(stringToHex(JSON.stringify(canonical(abi)))).slice(2);
const safePath = (s: string) =>
  /^[a-zA-Z0-9_./-]+$/.test(s) &&
  !s.split("/").includes("..") &&
  !s.startsWith("/");
async function fetchAsset(path: string, d: Deployment) {
  if (!safePath(path)) throw Error("Unsafe deployment asset path");
  const item = d.assets.find((a) => a.path === path);
  if (!item) throw Error(`Unlisted deployment asset: ${path}`);
  const response = await fetch(new URL(path, document.baseURI));
  if (!response.ok) throw Error(`Unable to load ${path}`);
  const bytes = await response.arrayBuffer();
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  if (digest !== item.sha256) throw Error(`Integrity check failed: ${path}`);
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function loadRuntime() {
  const response = await fetch(
    new URL("imd-deployment.json", document.baseURI),
    { cache: "no-store" },
  );
  if (!response.ok)
    throw Error(
      "Deployment configuration is unavailable. Reload to try again.",
    );
  const deployment: Deployment = await response.json();
  if (
    deployment.version !== 1 ||
    deployment.chainId !== deployment.network?.chainId ||
    !deployment.poolKey ||
    !deployment.network.rpcUrls.length
  )
    throw Error("Deployment configuration is inconsistent.");
  const abis: Record<string, Abi> = {};
  for (const c of deployment.contracts) {
    const abi = await fetchAsset(c.abiPath, deployment);
    if (!Array.isArray(abi) || hashAbi(abi) !== c.abiHash)
      throw Error(`ABI verification failed: ${c.name}`);
    abis[c.name] = abi;
  }
  for (const name of [
    "Burner",
    "LpGovernor",
    "PriceGuard",
    "VenueV3",
    "VenueV4",
  ])
    abis[name] = await fetchAsset(`abi/${name}.json`, deployment);
  const provenance = await fetchAsset("provenance.json", deployment);
  if (provenance.sourceCommit !== deployment.sourceCommit)
    throw Error("Source provenance mismatch");
  const chain: Chain = defineChain({
    id: deployment.chainId,
    name: deployment.network.name,
    nativeCurrency: deployment.network.nativeCurrency,
    rpcUrls: { default: { http: deployment.network.rpcUrls } },
    blockExplorers: {
      default: { name: "Explorer", url: deployment.network.explorer },
    },
    testnet: deployment.network.testnet,
  });
  const transport = fallback(
    deployment.network.rpcUrls.map((url) =>
      http(url, { timeout: 12_000, retryCount: 1 }),
    ),
    { rank: false, retryCount: 0 },
  );
  const client = createPublicClient({
    chain,
    transport,
    batch: { multicall: false },
    pollingInterval: 5000,
  });
  const wagmi = createConfig({
    chains: [chain],
    multiInjectedProviderDiscovery: true,
    connectors: [injected(), coinbaseWallet({ appName: "The Firm" })],
    storage: null,
    transports: { [chain.id]: transport },
  });
  return {
    deployment,
    abis,
    chain,
    client,
    wagmi,
    fromBlock: BigInt(provenance.deploymentBlock),
  };
}
export type Runtime = Awaited<ReturnType<typeof loadRuntime>>;
export const contract = (r: Runtime, name: string) => {
  const c = r.deployment.contracts.find((c) => c.name === name);
  if (!c) throw Error(`Contract missing: ${name}`);
  return c.address;
};
export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
export const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
]);
export const quoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
]);
export const routerAbi = parseAbi([
  "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
]);
export const permit2Abi = parseAbi([
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
]);
export const oftAbi = parseAbi([
  "function quoteSend((uint32 dstEid,bytes32 to,uint256 amountLD,uint256 minAmountLD,bytes extraOptions,bytes composeMsg,bytes oftCmd) sendParam,bool payInLzToken) view returns ((uint256 nativeFee,uint256 lzTokenFee) fee)",
]);
export const factoryAbi = parseAbi([
  "function claimFees(uint64)",
  "function setRequester(uint64,address)",
  "function positionOf(uint64) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),int24,int24,address)",
]);
// Labels only. Pickers and transactions always use the live PriceGuard list.
export const venueNames: Record<string, string> = {
  "0x7c5f5a4bbd8fd63184577525326123b519429bdc": "Uniswap v4",
  "0x03a520b32c04bf3beef7beb72e919cf822ed34f1": "Uniswap v3",
  "0x46a15b0b27311cedf172ab29e4f4766fbe7f4364": "PancakeSwap v3",
  "0x80c7dd17b01855a6d2347444a0fcc36136a314de": "SushiSwap v3",
  "0x827922686190790b37229fd06084350e74485b72": "Aerodrome Slipstream",
  "0x4857db576ee0e45f10525ec59527bfd10beec60b":
    "Aerodrome Slipstream (second factory)",
};
export const venueLabel = (address: Address) =>
  venueNames[address.toLowerCase()] ?? address;
