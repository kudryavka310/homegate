export interface CommandInteraction {
  type: 2;
  data: { type: 1; name: string };
}

export type Interaction = { type: 1 } | CommandInteraction;

export type InteractionResponse =
  | { type: 1 }
  | {
      type: 4;
      data: {
        content: string;
        flags: 64;
        allowed_mentions: { parse: [] };
      };
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isInteraction(value: unknown): value is Interaction {
  if (!isRecord(value)) return false;
  if (value.type === 1) return true;
  return value.type === 2 && isRecord(value.data)
    && value.data.type === 1 && typeof value.data.name === "string"
    && value.data.name.length > 0 && value.data.name.length <= 32;
}
