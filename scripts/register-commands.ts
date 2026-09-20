import { registerCommandsWithToken } from "../src/discord/command-registration";

async function main() {
  const applicationId = process.env.DISCORD_APPLICATION_ID;
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!applicationId || !/^\d{17,20}$/.test(applicationId)
    || !guildId || !/^\d{17,20}$/.test(guildId)
    || !token || token.startsWith("replace_with_")) {
    throw new Error("Set DISCORD_APPLICATION_ID, DISCORD_GUILD_ID and DISCORD_BOT_TOKEN in .env.");
  }

  await registerCommandsWithToken({
    applicationId,
    accessToken: token,
    authScheme: "Bot",
    guildId,
  });
  for (const name of ["ping", "status", "lock", "unlock"]) console.log(`Registered /${name}`);
  console.log("All four HomeGate guild commands are ready.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Command registration failed.");
  process.exitCode = 1;
});
