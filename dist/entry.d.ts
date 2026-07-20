import { ExtensionAPI } from '@earendil-works/pi-coding-agent';

declare function resolveUserId(configUserId: string): string;
/**
 * Build the auto-recall context block for a turn from a prefetched search
 * result. Best-effort — returns "" when disabled, the prompt is blank, or
 * nothing matches; must never block the turn.
 */
declare function formatRecallContext(enabled: boolean, memories: unknown[]): string;
declare function mem0Extension(pi: ExtensionAPI): void;

export { mem0Extension as default, formatRecallContext, resolveUserId };
