//! Weekly digest composition. Pure and transport-independent: the route
//! gathers data, this module turns it into a readable plain-text digest, and
//! a NotificationTransport carries it out.

export type DigestInput = {
  generatedAt: string;
  followUpsDue: Array<{ title: string; nextAction: string }>;
  savedJobClosures: Array<{ title: string; closed: boolean }>;
  unseenStrongMatches: number;
};

export type DigestContent = {
  subject: string;
  text: string;
};

const BULLET = "  • ";

export function buildWeeklyDigest(input: DigestInput): DigestContent {
  const lines: string[] = [];
  const weekOf = input.generatedAt.slice(0, 10);
  lines.push(`RoleAtlas weekly briefing — ${weekOf}`);
  lines.push("");

  if (input.followUpsDue.length > 0) {
    lines.push(`Follow-ups due (${input.followUpsDue.length})`);
    for (const item of input.followUpsDue) {
      lines.push(`${BULLET}${item.title}${item.nextAction ? ` — ${item.nextAction}` : ""}`);
    }
    lines.push("");
  }

  if (input.savedJobClosures.length > 0) {
    lines.push("Saved role changes");
    for (const item of input.savedJobClosures) {
      lines.push(`${BULLET}${item.title} ${item.closed ? "has closed" : "may have closed"}`);
    }
    lines.push("");
  }

  if (input.unseenStrongMatches > 0) {
    const count = input.unseenStrongMatches;
    lines.push(
      `${count} highly ranked role${count === 1 ? "" : "s"} from recent searches ha${count === 1 ? "s" : "ve"} not been reviewed yet.`,
    );
    lines.push("");
  }

  if (lines[lines.length - 1] === "") lines.pop();
  if (
    input.followUpsDue.length === 0 &&
    input.savedJobClosures.length === 0 &&
    input.unseenStrongMatches === 0
  ) {
    lines.push("Nothing needs your attention this week. Your searches keep running in the background.");
    return { subject: `RoleAtlas weekly briefing — ${weekOf}`, text: lines.join("\n") };
  }
  lines.push("Open RoleAtlas to act on any of these.");
  return { subject: `RoleAtlas weekly briefing — ${weekOf}`, text: lines.join("\n") };
}
