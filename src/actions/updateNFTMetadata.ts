import {
    elizaLogger,
    composePromptFromState,
    parseKeyValueXml,
    ModelType,
    type IAgentRuntime,
    type Memory,
    type State,
    type HandlerCallback,
    Content,
} from "@elizaos/core";
import { Address, beginCell, internal, toNano } from "@ton/ton";
import { z } from "zod";
import { initWalletProvider, WalletProvider } from "../providers/wallet";
import {
    uploadFolderToIPFS,
    updateMetadataFiles,
    uploadJSONToIPFS,
    base64ToHex,
    waitSeqnoContract,
} from "../utils/util";
import path from "path";

/**
 * Extended interface for NFT metadata update content.
 * - nftAddress: The target NFT smart contract address.
 * - metadata: Partial NFT metadata update. All fields are optional, supporting partial edits.
 *   * storage: Option for metadata storage ("prompt" or "file").
 * Additionally, for on-chain updates, optional fields below enable crafting the new on-chain content:
 * - newCollectionMeta: The new collection metadata URL.
 * - newNftCommonMeta: The new NFT common metadata URL.
 * - royaltyAddress: The address to receive royalties.
 */
export interface UpdateNFTMetadataContent extends Content {
    nftAddress: string;
    storage: "prompt" | "file";
    imagesFolderPath?: string;
    metadataFolderPath?: string;
    metadata?: {
        name?: string;
        description?: string;
        image?: string;
        content_url?: string;
        attributes?: any[];
    };
    newCollectionMeta?: string;
    newNftCommonMeta?: string;
    royaltyPercent?: number;
    royaltyAddress?: string;
}

/**
 * Define schema for updating NFT metadata.
 */
const updateNFTMetadataSchema = z.object({
    nftAddress: z.string().nonempty({ message: "NFT address is required" }),
    storage: z.enum(["prompt", "file"]).default("prompt"),
    imagesFolderPath: z.string().optional(),
    metadataFolderPath: z.string().optional(),
    metadata: z
        .object({
            name: z.string().optional(),
            description: z.string().optional(),
            image: z.string().optional(),
            content_url: z.string().optional(),
            attributes: z.array(z.any()).optional(),
        })
        .optional(),
    // New fields for on-chain update via custom message:
    newCollectionMeta: z.string().optional(),
    newNftCommonMeta: z.string().optional(),
    royaltyPercent: z.number().optional(),
    royaltyAddress: z.string().optional(),
});

const updateNFTMetadataTemplate = `<system>
Analyze the conversation and extract the following information about the requested NFT metadata update:
- NFT address
- Storage type (prompt or file)
- Metadata fields to update (name, description, image)
- Folder paths (for file storage)
- Royalty information (if applicable)
- Collection metadata URLs (if applicable)

Format the response as key-value pairs in XML format.
</system>

{{recentMessages}}

<message>
Extract the NFT metadata update details from the conversation above.
Respond with the following format:

<nftAddress>nft_address</nftAddress>
<storage>prompt_or_file</storage>
<imagesFolderPath>path_if_file_storage</imagesFolderPath>
<metadataFolderPath>path_if_file_storage</metadataFolderPath>
<royaltyPercent>percent_if_applicable</royaltyPercent>
<royaltyAddress>address_if_applicable</royaltyAddress>
<metadataName>updated_name</metadataName>
<metadataDescription>updated_description</metadataDescription>
<metadataImage>updated_image_url</metadataImage>
<newCollectionMeta>collection_meta_url_if_applicable</newCollectionMeta>
<newNftCommonMeta>nft_common_meta_url_if_applicable</newNftCommonMeta>
</message>`;

function isUpdateNFTMetadataContent(
    content: Content
): content is UpdateNFTMetadataContent {
    return (
        typeof content.nftAddress === "string" &&
        typeof content.storage === "string" &&
        (content.storage === "prompt" || content.storage === "file")
    );
}

/**
 * Builds the update details by composing the context using the updateNFTMetadataTemplate
 * and generating the desired object using the provided schema.
 */
const buildUpdateDetails = async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State
): Promise<UpdateNFTMetadataContent> => {
    // Initialize or update state.
    let currentState = state;
    if (!currentState) {
        currentState = (await runtime.composeState(message)) as State;
    } else {
        currentState = await runtime.composeState(message, ["RECENT_MESSAGES"]);
    }

    const prompt = composePromptFromState({
        state: currentState,
        template: updateNFTMetadataTemplate,
    });

    const result = await runtime.useModel(ModelType.TEXT_SMALL, {
        prompt,
    });

    const resultText =
        typeof result === "string" ? result : (result as any).value || "";
    const parsedContent = parseKeyValueXml(resultText);

    // Build metadata object from parsed content
    const metadata =
        parsedContent &&
        (parsedContent.metadataName ||
            parsedContent.metadataDescription ||
            parsedContent.metadataImage)
            ? {
                  name: parsedContent.metadataName || undefined,
                  description: parsedContent.metadataDescription || undefined,
                  image: parsedContent.metadataImage || undefined,
              }
            : undefined;

    const updateContent: UpdateNFTMetadataContent = {
        nftAddress: parsedContent?.nftAddress || "",
        storage: (parsedContent?.storage as "prompt" | "file") || "prompt",
        imagesFolderPath: parsedContent?.imagesFolderPath || undefined,
        metadataFolderPath: parsedContent?.metadataFolderPath || undefined,
        royaltyPercent: parsedContent?.royaltyPercent
            ? parseFloat(parsedContent.royaltyPercent)
            : undefined,
        royaltyAddress: parsedContent?.royaltyAddress || undefined,
        metadata,
        newCollectionMeta: parsedContent?.newCollectionMeta || undefined,
        newNftCommonMeta: parsedContent?.newNftCommonMeta || undefined,
        text: "", // Required by Content interface
    };

    // Validate with schema
    const validatedContent = updateNFTMetadataSchema.parse(updateContent);
    return validatedContent as UpdateNFTMetadataContent;
};

/**
 * The UpdateNFTMetadataAction class processes metadata updates.
 */
class UpdateNFTMetadataAction {
    private walletProvider: WalletProvider;

    constructor(walletProvider: WalletProvider) {
        this.walletProvider = walletProvider;
    }

    /**
     * Uploads content to IPFS based on storage type
     */
    private async uploadContent(
        params: UpdateNFTMetadataContent
    ): Promise<{ metadataIpfsHash: string; imagesIpfsHash?: string }> {
        let metadataIpfsHash: string;
        let imagesIpfsHash: string | undefined;

        if (params.storage === "file") {
            if (!params.imagesFolderPath || !params.metadataFolderPath) {
                throw new Error(
                    "Image and metadata folder paths are required for file storage"
                );
            }

            elizaLogger.log("Started uploading images to IPFS...");
            imagesIpfsHash = await uploadFolderToIPFS(params.imagesFolderPath);
            elizaLogger.log(
                `Successfully uploaded the pictures to ipfs: https://gateway.pinata.cloud/ipfs/${imagesIpfsHash}`
            );

            elizaLogger.log("Started uploading metadata files to IPFS...");
            await updateMetadataFiles(
                params.metadataFolderPath,
                imagesIpfsHash
            );
            metadataIpfsHash = await uploadFolderToIPFS(
                params.metadataFolderPath
            );
            elizaLogger.log(
                `Successfully uploaded the metadata to ipfs: https://gateway.pinata.cloud/ipfs/${metadataIpfsHash}`
            );
            return { metadataIpfsHash, imagesIpfsHash };
        } else if (params.storage === "prompt") {
            if (!params.metadata) {
                throw new Error("Metadata is required for prompt storage");
            }
            metadataIpfsHash = await uploadJSONToIPFS(params.metadata);
            return { metadataIpfsHash };
        }

        throw new Error("Invalid storage type");
    }

    /**
     * Crafts and sends an on-chain update transaction that changes the NFT's content.
     * The message follows the provided example:
     * - Opcode 4 indicates a "change content" operation.
     * - The message body stores a reference to a content cell (built from the new collection meta and NFT common meta)
     *   and a royalty cell.
     */
    private async updateNFTMetadataOnChain(
        params: UpdateNFTMetadataContent
    ): Promise<string> {
        // Parse the NFT address.
        const nftTonAddress = Address.parse(params.nftAddress);

        // Build the collection metadata cell.
        const collectionMetaCell = beginCell()
            .storeUint(1, 8) // Indicates offchain metadata.
            .storeStringTail(params.newCollectionMeta!)
            .endCell();

        // Build the NFT common metadata cell.
        const nftCommonMetaCell = beginCell()
            .storeUint(1, 8)
            .storeStringTail(params.newNftCommonMeta!)
            .endCell();

        // Build the content cell which contains both references.
        const contentCell = beginCell()
            .storeRef(collectionMetaCell)
            .storeRef(nftCommonMetaCell)
            .endCell();

        // Build the royalty cell.
        const royaltyCell = beginCell()
            .storeUint(params.royaltyPercent! * 100, 16) // factor (e.g., 5% = 500).
            .storeUint(10000, 16) // base.
            .storeAddress(Address.parse(params.royaltyAddress!))
            .endCell();

        // Build the update message body using opcode 4.
        const messageBody = beginCell()
            .storeUint(4, 32) // Opcode for changing content.
            .storeUint(0, 64) // Query id (0).
            .storeRef(contentCell)
            .storeRef(royaltyCell)
            .endCell();

        // Create the internal update message.
        const updateMessage = internal({
            to: nftTonAddress,
            value: toNano("0.05"),
            bounce: true,
            body: messageBody,
        });

        const walletClient = this.walletProvider.getWalletClient();
        const contract = walletClient.open(this.walletProvider.wallet);

        const seqno: number = await contract.getSeqno();
        const transfer = await contract.createTransfer({
            seqno,
            secretKey: this.walletProvider.keypair.secretKey,
            messages: [updateMessage],
        });

        await contract.send(transfer);
        elizaLogger.log("Transaction sent, waiting for confirmation...");

        await waitSeqnoContract(seqno, contract);

        const state = await walletClient.getContractState(
            this.walletProvider.wallet.address
        );
        const lastTransaction = state.lastTransaction;
        if (!lastTransaction) {
            throw new Error("No last transaction found");
        }
        const { lt: _, hash: lastHash } = lastTransaction;
        return base64ToHex(lastHash);
    }

    async update(params: UpdateNFTMetadataContent): Promise<string> {
        const { metadataIpfsHash } = await this.uploadContent(params);

        // Set the new metadata URLs if not already provided
        if (!params.newCollectionMeta) {
            params.newCollectionMeta = `ipfs://${metadataIpfsHash}/collection.json`;
        }

        if (!params.newNftCommonMeta) {
            params.newNftCommonMeta = `ipfs://${metadataIpfsHash}/`;
        }

        return await this.updateNFTMetadataOnChain(params);
    }
}

export default {
    name: "UPDATE_NFT_METADATA",
    similes: ["NFT_UPDATE", "UPDATE_METADATA"],
    description:
        "Updates NFT metadata post-mint. Supports partial or full metadata edits with on-chain or off-chain constraints. For off-chain storage, metadata is uploaded using Helia. For on-chain updates, a custom update message (using opcode 4) is sent, updating content and royalty information.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state?: State,
        _options?: Record<string, unknown>,
        callback?: HandlerCallback
    ) => {
        elizaLogger.log("Starting UPDATE_NFT_METADATA handler...");

        const updateDetails = await buildUpdateDetails(
            runtime,
            message,
            state!
        );

        // Validate transfer content
        if (!isUpdateNFTMetadataContent(updateDetails)) {
            if (callback) {
                callback({
                    text: "Unable to process update request. Invalid content provided.",
                    content: { error: "Invalid update content" },
                });
            }
            return false;
        }

        try {
            // Set default paths if using file storage
            if (updateDetails.storage === "file") {
                updateDetails.imagesFolderPath =
                    runtime.getSetting("TON_NFT_IMAGES_FOLDER") ||
                    path.join(process.cwd(), "ton_nft_images");
                updateDetails.metadataFolderPath =
                    runtime.getSetting("TON_NFT_METADATA_FOLDER") ||
                    path.join(process.cwd(), "ton_nft_metadata");
            }

            // Process the metadata update.
            const walletProvider = await initWalletProvider(runtime);
            const updateAction = new UpdateNFTMetadataAction(walletProvider);
            const hash = await updateAction.update(updateDetails);

            // Prepare the result.
            const result = {
                status: "success",
                nftAddress: updateDetails.nftAddress,
                updatedMetadata: updateDetails.metadata,
                message: "NFT metadata updated successfully",
                hash: hash,
            };

            if (callback) {
                callback({
                    text: `NFT metadata updated successfully`,
                    content: result,
                });
            }
            return true;
        } catch (error: any) {
            elizaLogger.error("Error updating NFT metadata:", error);
            if (callback) {
                callback({
                    text: `Error updating NFT metadata: ${error.message}`,
                    content: { error: error.message },
                });
            }
            return false;
        }
    },
    validate: async (_runtime: IAgentRuntime) => true,
    template: updateNFTMetadataTemplate,
    examples: [
        [
            {
                user: "{{user1}}",
                name: "{{user1}}",
                content: {
                    nftAddress: "NFT_123456789",
                    metadata: {
                        name: "Updated NFT Artwork",
                        description: "New description for NFT",
                        image: "https://example.com/new-image.png",
                        storage: "off-chain", // or "on-chain"
                    },
                    // Fields for on-chain update (if storage is "on-chain")
                    newCollectionMeta:
                        "https://example.com/new-collection-meta.json",
                    newNftCommonMeta:
                        "https://example.com/new-nft-common-meta.json",
                    royaltyAddress: "EQRoyaltyAddressExample",
                    action: "UPDATE_NFT_METADATA",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "NFT metadata updated successfully",
                },
            },
        ],
    ],
};
