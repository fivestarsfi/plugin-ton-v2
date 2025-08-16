import type { IAgentRuntime, Memory, Provider, State } from "@elizaos/core";

import {
    TonConnect,
    type WalletInfoRemote,
    isWalletInfoRemote,
    UserRejectsError,
    type WalletInfo,
    type SendTransactionRequest,
} from "@tonconnect/sdk";
import NodeCache from "node-cache";
import { CONFIG_KEYS } from "../enviroment";
import { cacheManager } from "../cache";

const PROVIDER_CONFIG = {
    BRIDGE_URL: "https://bridge.tonapi.io/bridge",
    MAX_RETRIES: 3,
    RETRY_DELAY: 2000,
    CACHE_TTL: {
        DEFAULT_FILE_CACHE: 86400, // 24 hours
        DEFAULT_MEMORY_CACHE: 3600, // 1 hour
        CONNECTION: 86400, // 24 hours
    },
};

const CACHE_KEYS = {
    CACHE_KEY: "ton/connect",
    CURRENT_WALLET: "currentWallet",
    CONNECTOR: "connector",
};

export interface ConnectorStatus {
    status: "Connected" | "Disconnected" | "Connecting" | "Disconnecting";
    walletInfo: WalletInfo | null;
}

interface IStorage {
    setItem(key: string, value: string): Promise<void>;
    getItem(key: string): Promise<string | null>;
    removeItem(key: string): Promise<void>;
}

class CacheManager {
    constructor(
        private memoryCache: NodeCache,
        private runtime: IAgentRuntime,
        private baseCacheKey: string,
        private defaultTTL: number
    ) {}

    async get<T>(key: string): Promise<T | null> {
        const cacheKey = `${this.baseCacheKey}/${key}`;

        // Check memory cache first
        const memoryCached = this.memoryCache.get<T>(cacheKey);
        if (memoryCached) return memoryCached;

        // Check global cache
        const globalCached = cacheManager.get<T>(cacheKey);
        if (globalCached) {
            this.memoryCache.set(cacheKey, globalCached);
            return globalCached;
        }

        return null;
    }

    async set<T>(key: string, data: T, ttl?: number): Promise<void> {
        const cacheKey = `${this.baseCacheKey}/${key}`;
        const expiresIn = ttl || this.defaultTTL;

        // Set in memory cache
        this.memoryCache.set(cacheKey, data, expiresIn);

        // Set in runtime cache
        cacheManager.set(cacheKey, data, expiresIn);
    }

    async delete(key: string): Promise<void> {
        const cacheKey = `${this.baseCacheKey}/${key}`;
        this.memoryCache.del(cacheKey);
        cacheManager.delete(cacheKey);
    }

    async clear(): Promise<void> {
        this.memoryCache.flushAll();
        // Note: runtime doesn't have a clear all method, so we can't clear all keys
    }
}

class TonConnectStorage implements IStorage {
    constructor(private runtime: IAgentRuntime) {}

    async setItem(key: string, value: string): Promise<void> {
        cacheManager.set(`tonconnect/${key}`, value);
    }

    async getItem(key: string): Promise<string | null> {
        return cacheManager.get<string>(`tonconnect/${key}`) || null;
    }

    async removeItem(key: string): Promise<void> {
        cacheManager.delete(`tonconnect/${key}`);
    }
}

export class TonConnectProvider {
    private static instance: TonConnectProvider | null = null;
    private connector: TonConnect;
    private cacheManager: CacheManager | null = null;
    private unsubscribe: (() => void) | null = null;
    private bridgeUrl: string = "";
    private manifestUrl: string = "";
    private initialized: boolean = false;
    private connected: boolean = false;
    private runtime: IAgentRuntime | null = null;
    private constructor() {
        this.connector = {} as TonConnect; // Temporary init
    }

    public static getInstance(): TonConnectProvider {
        if (!TonConnectProvider.instance) {
            TonConnectProvider.instance = new TonConnectProvider();
        }
        return TonConnectProvider.instance;
    }

    public async initialize(
        manifestUrl: string,
        bridgeUrl: string,
        fileCache: IAgentRuntime
    ): Promise<void> {
        if (this.initialized) return;

        this.validateManifestUrl(manifestUrl);
        this.validateBridgeUrl(bridgeUrl);

        const memoryCache = new NodeCache({
            stdTTL: PROVIDER_CONFIG.CACHE_TTL.DEFAULT_MEMORY_CACHE,
            checkperiod: 60,
        });

        this.cacheManager = new CacheManager(
            memoryCache,
            fileCache,
            CACHE_KEYS.CACHE_KEY,
            PROVIDER_CONFIG.CACHE_TTL.DEFAULT_FILE_CACHE
        );

        await this.initializeConnection(manifestUrl, fileCache);
        this.initialized = true;
        this.bridgeUrl = bridgeUrl;
    }

    private validateManifestUrl(url: string): void {
        if (!url || !url.startsWith("http")) {
            throw new Error("Invalid manifest URL provided");
        }
    }

    private validateBridgeUrl(url: string): void {
        if (!url || !url.startsWith("http")) {
            throw new Error("Invalid bridge URL provided");
        }
    }

    private async initializeConnection(
        manifestUrl: string,
        fileCache: IAgentRuntime
    ): Promise<void> {
        try {
            const storage = new TonConnectStorage(fileCache);

            this.connector = new TonConnect({ manifestUrl, storage });

            this.setupEventListeners();
        } catch (error) {
            console.error("Failed to initialize connection:", error);
        }
    }

    private setupEventListeners(): void {
        this.unsubscribe = null;
        this.unsubscribe = this.connector.onStatusChange((wallet) => {
            if (wallet) {
                this.connected = true;
                this.setCachedData(CACHE_KEYS.CURRENT_WALLET, wallet);
            } else {
                this.connected = false;
                this.deleteCachedData(CACHE_KEYS.CURRENT_WALLET);
            }
        });
    }

    private async fetchWithRetry<T>(
        operation: () => Promise<T>,
        retries = PROVIDER_CONFIG.MAX_RETRIES
    ): Promise<T> {
        for (let i = 0; i < retries; i++) {
            try {
                return await operation();
            } catch (error) {
                // if user declines, don't retry
                if (
                    error instanceof UserRejectsError ||
                    (error as any).code === 300
                ) {
                    throw error;
                }
                if (i === retries - 1) throw error;
                const delay = PROVIDER_CONFIG.RETRY_DELAY * Math.pow(2, i);
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
        throw new Error("Operation failed after max retries");
    }

    async getWalletInfoList(): Promise<WalletInfo[]> {
        const walletsList = await this.fetchWithRetry(() =>
            this.connector.getWallets()
        );
        return walletsList;
    }

    async connect(walletName?: string): Promise<string | null> {
        try {
            const walletsList = await this.fetchWithRetry(() =>
                this.connector.getWallets()
            );
            const remoteWallets = walletsList.filter(
                isWalletInfoRemote
            ) as WalletInfoRemote[];

            if (remoteWallets.length === 0) {
                throw new Error("No remote wallets available");
            }

            const walletUniversalLink = walletName
                ? remoteWallets.find((wallet) => wallet.name === walletName)
                      ?.universalLink
                : null;

            // Ensure universalLink is a string before passing it
            if (!walletUniversalLink) {
                throw new Error("Wallet universal link is required");
            }

            const walletConnectionSource = {
                universalLink: walletUniversalLink,
                bridgeUrl: this.bridgeUrl,
            };

            const universalLink = this.connector.connect(
                walletConnectionSource
            );

            return universalLink || null;
        } catch (error) {
            this.handleError("Connection error", error);
            return null;
        }
    }

    private async getCachedData<T>(key: string): Promise<T | null> {
        return this.cacheManager ? await this.cacheManager.get<T>(key) : null;
    }

    private async setCachedData<T>(
        key: string,
        data: T,
        ttl?: number
    ): Promise<void> {
        if (this.cacheManager) {
            await this.cacheManager.set(key, data, ttl);
        }
    }

    private async deleteCachedData(key: string): Promise<void> {
        if (this.cacheManager) {
            await this.cacheManager.delete(key);
        }
    }

    private async clearCache(): Promise<void> {
        if (this.cacheManager) {
            await this.cacheManager.clear();
        }
    }

    private handleError(context: string, error: any): void {
        if (error instanceof UserRejectsError) {
            console.warn(`${context}: User rejected the operation`);
        } else {
            console.error(`${context}:`, error);
        }
    }

    async disconnect(): Promise<void> {
        try {
            if (this.connector.connected) {
                await this.connector.disconnect();
            }
            if (this.unsubscribe) {
                this.unsubscribe();
                this.unsubscribe = null;
            }
            await this.clearCache();
        } catch (error) {
            this.handleError("Disconnection error", error);
        }
    }

    async formatConnectionStatus(
        runtime: IAgentRuntime
    ): Promise<ConnectorStatus> {
        const wallet = await this.getCachedData<WalletInfo>(
            CACHE_KEYS.CURRENT_WALLET
        );

        if (!this.isConnected() || !wallet) {
            return {
                status: "Disconnected",
                walletInfo: null,
            };
        }

        return {
            status: "Connected",
            walletInfo: wallet,
        };
    }

    async sendTransaction(transaction: SendTransactionRequest): Promise<any> {
        if (!this.connector.connected) {
            throw new Error("Wallet not connected");
        }

        return await this.fetchWithRetry(async () => {
            try {
                return await this.connector.sendTransaction(transaction);
            } catch (error) {
                this.handleError("Transaction error", error);
                throw error;
            }
        });
    }

    isConnected = (): boolean => this.connected;
    getWalletInfo = () => this.connector.wallet;
}

export const initTonConnectProvider = async (runtime: IAgentRuntime) => {
    const manifestUrl =
        runtime.getSetting(CONFIG_KEYS.TON_MANIFEST_URL) ?? null;
    if (!manifestUrl) {
        throw new Error("TON_MANIFEST_URL is not set");
    }

    const bridgeUrl =
        runtime.getSetting(CONFIG_KEYS.TON_BRIDGE_URL) ??
        PROVIDER_CONFIG.BRIDGE_URL;

    const provider = TonConnectProvider.getInstance();
    await provider.initialize(manifestUrl, bridgeUrl, runtime);
    return provider;
};

export const tonConnectProvider: Provider = {
    name: "tonConnectProvider",
    description:
        "Provides TON Connect wallet connection status and information",
    async get(
        runtime: IAgentRuntime,
        message: Memory,
        state: State
    ): Promise<{ text: string; data?: any }> {
        // exit if TONCONNECT is not used
        if (!runtime.getSetting(CONFIG_KEYS.TON_MANIFEST_URL)) {
            return { text: "TONCONNECT is not enabled." };
        }

        try {
            const provider = await initTonConnectProvider(runtime);
            const status = await provider.formatConnectionStatus(runtime);
            if (typeof status === "string") {
                return { text: status };
            }
            return {
                text: `Wallet ${(status as any).status}: ${(status as any).walletInfo?.name || "Unknown"}`,
                data: status,
            };
        } catch (error) {
            console.error("TON Connect provider error:", error);
            return {
                text: "Unable to connect to TON wallet. Please try again later.",
            };
        }
    },
};

