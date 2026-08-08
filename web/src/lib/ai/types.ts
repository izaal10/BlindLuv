/** Dimensions the agent scores on. Deliberately behavioural, never physical. */
export const TRAIT_KEYS = [
  "creative",
  "technical",
  "social",
  "outdoors",
  "intellectual",
  "adventurous",
] as const;

export type TraitKey = (typeof TRAIT_KEYS)[number];

export type Traits = Record<TraitKey, number>;

export interface ProfileInput {
  /** Free-text: what they enjoy. */
  likes: string;
  /** Free-text: deal-breakers. */
  dislikes: string;
  /** Free-text: how they like to talk to people. */
  conversationStyle: string;
  city: string;
}

export interface AgentProfile {
  traits: Traits;
  /** Short, non-identifying tags shown on the blind card. */
  interests: string[];
  /** Normalised deal-breakers used to veto matches outright. */
  dealBreakers: string[];
  /** One sentence the other side can read before revealing anything. */
  blurb: string;
  /** Which engine produced this — surfaced in the UI, never hidden. */
  source: "router" | "heuristic";
}

export interface Compatibility {
  score: number; // 0..100
  reasons: string[];
  sharedInterests: string[];
  vetoed: boolean;
  vetoReason?: string;
  source: "router" | "heuristic";
}

export interface VenueSuggestion {
  name: string;
  kind: string;
  why: string;
}

export interface DatePlan {
  venues: VenueSuggestion[];
  opener: string;
  source: "router" | "heuristic";
}
