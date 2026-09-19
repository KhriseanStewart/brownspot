/**
 * User-facing model choices: opus | sonnet | auto.
 * Auto picks the cheapest suitable model for the main turn;
 * side jobs (summarize / memory extract) always use the cheap model.
 */
import fs from "node:fs";
import path from "node:path";
import { AGENT_HOME, ensureAgentDirs } from "./memory/paths.ts";
import { PRODUCT } from "../product.ts";
import { SUMMARY_MODEL } from "../config.ts";

export type ModelChoice = "opus" | "sonnet" | "auto";

export const MODEL_CHOICES: readonly ModelChoice[] = ["opus", "sonnet", "auto"] as const;

/** Concrete OpenRouter ids for the three user-facing picks. */
export const MODEL_IDS = {
  opus: "anthropic/claude-opus-4.1",
  sonnet: PRODUCT.defaultModel, // anthropic/claude-sonnet-5
  /** Cheap model for summarize / memory / auto-simple turns */
  cheap: SUMMARY_MODEL,
} as const;

const PREF_PATH = path.join(AGENT_HOME, "model-pref.json");

type PrefFile = { choice: ModelChoice };

let sessionChoice: ModelChoice | null = null;

function isChoice(v: unknown): v is ModelChoice {
  return v === "opus" || v === "sonnet" || v === "auto";
}

export function loadModelChoice(): ModelChoice {
  if (sessionChoice) return sessionChoice;
  try {
    const raw = fs.readFileSync(PREF_PATH, "utf8");
    const parsed = JSON.parse(raw) as PrefFile;
    if (isChoice(parsed.choice)) {
      sessionChoice = parsed.choice;
      return parsed.choice;
    }
  } catch {
    /* missing or invalid — default */
  }
  sessionChoice = "auto";
  return "auto";
}

export function setModelChoice(choice: ModelChoice): void {
  sessionChoice = choice;
  ensureAgentDirs();
  const data: PrefFile = { choice };
  fs.writeFileSync(PREF_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function cheapModelId(): string {
  return MODEL_IDS.cheap;
}

/**
 * Heuristic router for **auto**: prefer cheaper sonnet for most work;
 * escalate to opus for hard reasoning; use cheap flash for trivial turns.
 */
export function resolveChatModelId(userText = ""): string {
  const choice = loadModelChoice();
  if (choice === "opus") return MODEL_IDS.opus;
  if (choice === "sonnet") return MODEL_IDS.sonnet;
  return pickAutoModel(userText);
}

function pickAutoModel(userText: string): string {
  const t = userText.toLowerCase();
  const hard =
    /\b(architect|architecture|refactor|security|prove|formal|complex|multi-?step|trade-?off|design system|deep dive|careful|thorough|opus)\b/.test(
      t,
    ) || t.length > 1200;
  if (hard) return MODEL_IDS.opus;

  const trivial =
    t.length < 80 &&
    /^(hi|hey|hello|thanks|thank you|ok|okay|yes|no|yep|nope|cool|whoami|\/whoami)\b/.test(
      t.trim(),
    );
  if (trivial) return MODEL_IDS.cheap;

  // Default auto path: sonnet (good quality, cheaper than opus)
  return MODEL_IDS.sonnet;
}

/** Models the hosted proxy may accept from the client. */
export function allowedProxyModels(): Set<string> {
  return new Set<string>([
    MODEL_IDS.opus,
    MODEL_IDS.sonnet,
    MODEL_IDS.cheap,
    PRODUCT.defaultModel,
  ]);
}

export function formatModelStatus(): string {
  const choice = loadModelChoice();
  const id = resolveChatModelId("");
  const lines = [
    `Current model mode: ${choice}`,
    `Resolved (no prompt): ${id}`,
    "",
    "Choices:",
    "  opus    — Claude Opus (hardest reasoning)",
    "  sonnet  — Claude Sonnet (default quality)",
    "  auto    — pick cheapest fit per turn (trivial→flash, normal→sonnet, hard→opus)",
    "",
    "Usage: /model          show this menu",
    "       /model opus     switch to opus",
    "       /model sonnet   switch to sonnet",
    "       /model auto     enable auto routing",
  ];
  return lines.join("\n");
}

/** Handle /model … Returns true if consumed. */
export function handleModelCommand(line: string): boolean {
  if (!line.startsWith("/model")) return false;
  const rest = line.slice("/model".length).trim().toLowerCase();
  if (!rest || rest === "help" || rest === "status") {
    console.log(formatModelStatus());
    return true;
  }
  if (isChoice(rest)) {
    setModelChoice(rest);
    const resolved =
      rest === "auto"
        ? "auto (routes per turn)"
        : `${rest} → ${rest === "opus" ? MODEL_IDS.opus : MODEL_IDS.sonnet}`;
    console.log(`Model set to ${resolved}`);
    return true;
  }
  console.log(`Unknown model "${rest}". Use: opus | sonnet | auto`);
  console.log(formatModelStatus());
  return true;
}

export function modelLabelForBanner(): string {
  const choice = loadModelChoice();
  if (choice === "auto") return "auto";
  return `${choice} (${choice === "opus" ? MODEL_IDS.opus : MODEL_IDS.sonnet})`;
}
