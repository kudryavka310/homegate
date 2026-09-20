import type { LockService } from "../services/lock-service";
import type { Interaction, InteractionResponse } from "../types/discord";
import { isCommandName } from "./commands";

export function message(content: string): InteractionResponse {
  return { type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } };
}

export async function handleInteraction(
  interaction: Interaction,
  locks: LockService,
): Promise<InteractionResponse> {
  if (interaction.type === 1) return { type: 1 };
  const name = interaction.data.name;
  if (!isCommandName(name)) return message("Unknown command.");

  switch (name) {
    case "ping":
      return message("HomeGate is running.");
    case "status": {
      const status = await locks.getStatus();
      return message(`${status.deviceName}\nStatus: ${status.state === "locked" ? "Locked" : "Unlocked"}`);
    }
    case "lock": {
      const { deviceName } = await locks.getStatus();
      await locks.lock();
      return message(`${deviceName} has been locked.`);
    }
    case "unlock": {
      const { deviceName } = await locks.getStatus();
      await locks.unlock();
      return message(`${deviceName} has been unlocked.`);
    }
  }
}
