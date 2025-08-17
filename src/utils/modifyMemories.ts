import { type IAgentRuntime, type Memory, type State } from "@elizaos/core";

export async function replaceLastMemory(
    runtime: IAgentRuntime,
    state: State,
    template: string
): Promise<Memory> {
    const memory = state.recentMessagesData[0];

    // In v1, we can't easily delete memories, so we'll skip this step
    // await runtime.removeMemory(memory.id, "messages");

    const prompt = template
        .replace("{{agentName}}", runtime.character.name)
        .replace("{{recentMessages}}", state.recentMessages || "");

    // Simple response generation - in v1 we'll just use the prompt as response
    const response = { text: prompt };

    const newMemory = {
        id: crypto.randomUUID() as `${string}-${string}-${string}-${string}-${string}`,
        userId: (memory as any).userId || "default",
        entityId: memory.entityId || undefined,
        agentId: memory.agentId,
        roomId: memory.roomId,
        content: {
            ...memory.content,
            text: response.text,
        },
        createdAt: Date.now(),
    } as Memory;

    await runtime.createMemory(newMemory, "messages");

    return newMemory;
}

export async function addMemory(
    runtime: IAgentRuntime,
    state: State,
    memory: Memory,
    template: string
): Promise<Memory> {
    const prompt = template
        .replace("{{agentName}}", runtime.character.name)
        .replace("{{recentMessages}}", state.recentMessages || "");

    // Simple response generation - in v1 we'll just use the prompt as response
    const response = { text: prompt };

    const newMemory = {
        id: crypto.randomUUID() as `${string}-${string}-${string}-${string}-${string}`,
        userId: (memory as any).userId || "default",
        entityId: memory.entityId || undefined,
        agentId: memory.agentId,
        roomId: memory.roomId,
        content: {
            text: response.text,
            inReplyTo: memory.content.inReplyTo,
            action: memory.content.action,
            source: memory.content.source,
        },
        createdAt: Date.now(),
    } as Memory;

    await runtime.createMemory(newMemory, "messages");

    return newMemory;
}
