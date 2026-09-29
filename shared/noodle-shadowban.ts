export type NoodleFlavor = "beef" | "chicken" | "octopus";

export type NoodleClickSnapshot = {
  totalClicks: number;
  beefClicks: number;
  chickenClicks: number;
  octopusClicks: number;
  experience: string;
};

/** Use isolated decoy counters for a shadowbanned player, falling back to their pre-ban score initially. */
export function getVisibleClickSnapshot(
  actual: NoodleClickSnapshot,
  shadow: Partial<NoodleClickSnapshot> | null | undefined,
  shadowBanned: boolean,
): NoodleClickSnapshot {
  if (!shadowBanned || !shadow) return actual;
  return {
    totalClicks: shadow.totalClicks ?? actual.totalClicks,
    beefClicks: shadow.beefClicks ?? actual.beefClicks,
    chickenClicks: shadow.chickenClicks ?? actual.chickenClicks,
    octopusClicks: shadow.octopusClicks ?? actual.octopusClicks,
    experience: shadow.experience ?? actual.experience,
  };
}

/** Advance only the local-looking decoy score; real public leaderboard counters remain frozen. */
export function incrementClickSnapshot(snapshot: NoodleClickSnapshot, flavor: NoodleFlavor, amount = 1): NoodleClickSnapshot {
  return {
    ...snapshot,
    totalClicks: snapshot.totalClicks + amount,
    beefClicks: snapshot.beefClicks + (flavor === "beef" ? amount : 0),
    chickenClicks: snapshot.chickenClicks + (flavor === "chicken" ? amount : 0),
    octopusClicks: snapshot.octopusClicks + (flavor === "octopus" ? amount : 0),
    experience: (BigInt(snapshot.experience || "0") + BigInt(amount)).toString(),
  };
}

/** Add a private decoy row only when it belongs in the caller's own top ten. */
export function includePrivateLeaderboardEntry<T extends { playerId: number; score: number }>(
  publicEntries: readonly T[],
  privateEntry: T,
  privateRank: number,
  limit = 10,
): T[] {
  if (privateRank > limit || publicEntries.some((entry) => entry.playerId === privateEntry.playerId)) {
    return [...publicEntries];
  }
  return [...publicEntries, privateEntry]
    .sort((left, right) => right.score - left.score || left.playerId - right.playerId)
    .slice(0, limit);
}
