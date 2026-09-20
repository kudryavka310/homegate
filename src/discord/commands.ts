// Shared by command registration and the router to avoid name drift.
export const commands = [
  { name: "ping", description: "Check whether HomeGate is running.", type: 1 },
  { name: "status", description: "Show the mock Studio Door status.", type: 1 },
  { name: "lock", description: "Lock the mock Studio Door.", type: 1 },
  { name: "unlock", description: "Unlock the mock Studio Door.", type: 1 },
] as const;

export type CommandDefinition = (typeof commands)[number];

export type CommandName = typeof commands[number]["name"];

export function isCommandName(name: string): name is CommandName {
  return commands.some((command) => command.name === name);
}
