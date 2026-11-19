/**
 * queryRefinementService.js
 * ─────────────────────────────────────────────────────────────
 * Point #7: Adaptive Query Refinement Engine
 *
 * Provides:
 *  - getAdaptiveWeights(priorities)   → runtime weight shifts
 *  - buildTemporarySemanticText(...)  → semantic text for temp embedding
 *  - blendEmbeddings(perm, temp, r)   → weighted vector blend
 *  - PRIORITY_OPTIONS                 → canonical list of priorities
 * ─────────────────────────────────────────────────────────────
 */

// ── Canonical priority options exposed to frontend ──────────
export const PRIORITY_OPTIONS = [
  { id: "emotional_safety",       label: "Emotional Safety",        emoji: "🛡️",  description: "Prioritize low-friction, emotionally resilient, and stable matches" },
  { id: "emotional_support",       label: "Emotional Support",       emoji: "💛",  description: "Someone who understands and supports you emotionally" },
  { id: "professional_alignment",  label: "Professional Alignment",  emoji: "💼",  description: "Similar career drive and professional lifestyle" },
  { id: "lifestyle_sync",         label: "Lifestyle Sync",          emoji: "🌿",  description: "Compatible daily routines and life rhythms" },
  { id: "shared_ambition",        label: "Shared Ambition",         emoji: "🚀",  description: "Matching goals, drive, and growth mindset" },
  { id: "calm_communication",     label: "Calm Communication",      emoji: "🕊️",  description: "Gentle, patient, and thoughtful conversations" },
  { id: "long_term_stability",    label: "Long-Term Stability",     emoji: "🏡",  description: "Commitment-focused and future-oriented match" },
];

// ── Base weights (must match the existing scoring in matchController) ──
const BASE_WEIGHTS = {
  vector_similarity:          0.22,
  intent_tag_match:           0.16,
  relationship_expectations:  0.16,
  lifestyle_rhythm:           0.12,
  professional_alignment:     0.09,
  emotional_tone_match:       0.12,
  preference_match:           0.05,
  personality_match:          0.04,
  contextual_match:           0.04,
};

// ── Weight shift deltas per priority ────────────────────────
// Positive = increase, negative = decrease.
// When multiple priorities are selected their deltas are averaged
// and the final weights are re-normalized to sum to 1.0.
const PRIORITY_DELTAS = {
  emotional_safety: {
    emotional_tone_match:      +0.15,
    personality_match:         +0.05,
    lifestyle_rhythm:          +0.05,
    professional_alignment:    -0.08,
    vector_similarity:         -0.05,
    preference_match:          -0.02,
    intent_tag_match:          -0.05,
    relationship_expectations: -0.05,
  },
  emotional_support: {
    intent_tag_match:          +0.08,
    personality_match:         +0.06,
    lifestyle_rhythm:          +0.04,
    professional_alignment:    -0.08,
    vector_similarity:         -0.06,
    preference_match:          -0.02,
    relationship_expectations: -0.01,
    contextual_match:          -0.01,
  },
  professional_alignment: {
    professional_alignment:    +0.12,
    intent_tag_match:          +0.04,
    vector_similarity:         +0.02,
    relationship_expectations: -0.08,
    lifestyle_rhythm:          -0.06,
    personality_match:         -0.02,
    preference_match:          -0.01,
    contextual_match:          -0.01,
  },
  lifestyle_sync: {
    lifestyle_rhythm:          +0.10,
    contextual_match:          +0.06,
    preference_match:          +0.02,
    professional_alignment:    -0.08,
    intent_tag_match:          -0.05,
    vector_similarity:         -0.03,
    relationship_expectations: -0.01,
    personality_match:         -0.01,
  },
  shared_ambition: {
    intent_tag_match:          +0.06,
    professional_alignment:    +0.06,
    vector_similarity:         +0.04,
    lifestyle_rhythm:          -0.06,
    preference_match:          -0.04,
    relationship_expectations: -0.03,
    contextual_match:          -0.02,
    personality_match:         -0.01,
  },
  calm_communication: {
    personality_match:         +0.08,
    intent_tag_match:          +0.06,
    lifestyle_rhythm:          +0.04,
    professional_alignment:    -0.08,
    vector_similarity:         -0.06,
    relationship_expectations: -0.02,
    preference_match:          -0.01,
    contextual_match:          -0.01,
  },
  long_term_stability: {
    relationship_expectations: +0.10,
    contextual_match:          +0.04,
    lifestyle_rhythm:          +0.04,
    professional_alignment:    -0.06,
    intent_tag_match:          -0.04,
    vector_similarity:         -0.04,
    preference_match:          -0.02,
    personality_match:         -0.02,
  },
};

/**
 * Compute adaptive weights for the given selected priorities (1-3 IDs).
 * Returns an object like BASE_WEIGHTS but with shifted + normalized values.
 */
export const getAdaptiveWeights = (selectedPriorities = []) => {
  if (!selectedPriorities || selectedPriorities.length === 0) {
    return { ...BASE_WEIGHTS };
  }

  // Average the deltas across all selected priorities
  const avgDelta = {};
  for (const key of Object.keys(BASE_WEIGHTS)) {
    let sum = 0;
    for (const prio of selectedPriorities) {
      const deltas = PRIORITY_DELTAS[prio];
      if (deltas && deltas[key] !== undefined) {
        sum += deltas[key];
      }
    }
    avgDelta[key] = sum / selectedPriorities.length;
  }

  // Apply deltas and floor at 0.01 so no dimension is completely zeroed
  const raw = {};
  for (const key of Object.keys(BASE_WEIGHTS)) {
    raw[key] = Math.max(0.01, BASE_WEIGHTS[key] + avgDelta[key]);
  }

  // Normalize so sum === 1.0
  const total = Object.values(raw).reduce((s, v) => s + v, 0);
  const normalized = {};
  for (const key of Object.keys(raw)) {
    normalized[key] = parseFloat((raw[key] / total).toFixed(4));
  }

  return normalized;
};

/**
 * Build a semantic text string from the user's temporary priorities,
 * optional free-text query, and emotional state.
 * This text is embedded to create a temporary vector for blending.
 */
export const buildTemporarySemanticText = (priorities = [], rawQuery = "", emotionalState = "") => {
  const parts = [];

  // Map priority IDs to descriptive semantic phrases
  const semanticMap = {
    emotional_safety:       "I need emotional safety, a low-friction lifestyle, calm energy, and an emotionally stable, resilient partner to avoid burnout",
    emotional_support:      "I need emotional support, empathy, understanding, gentle communication, and someone who is patient and caring",
    professional_alignment: "I want professional alignment, similar career ambition, shared work intensity, industry match, and leadership compatibility",
    lifestyle_sync:         "I want lifestyle synchronization, matching daily routines, similar social energy, compatible life pace, and shared living rhythm",
    shared_ambition:        "I want shared ambition, matching drive and goals, mutual growth mindset, high motivation, and aligned career trajectories",
    calm_communication:     "I value calm communication, gentle dialogue, patient conversations, thoughtful discussions, and peaceful interaction styles",
    long_term_stability:    "I am looking for long-term stability, commitment, future planning, relationship security, and consistent partnership",
  };

  // The user's own words lead: the pillar sentences are identical for every
  // user, so placing them first let them dominate the embedding and made
  // different queries produce near-identical vectors.
  const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
  if (query) {
    parts.push(query.slice(0, MAX_QUERY_LENGTH));
  }

  for (const prio of priorities) {
    if (semanticMap[prio]) {
      parts.push(semanticMap[prio]);
    }
  }

  if (emotionalState && emotionalState.trim()) {
    parts.push(`Current emotional state: ${emotionalState.trim()}`);
  }

  return parts.join(". ");
};

// ── Free-text query limits ──────────────────────────────────
export const MIN_QUERY_LENGTH = 3;
export const MAX_QUERY_LENGTH = 200;

/**
 * Validate a refinement request. A session is valid with pillars, with a
 * free-text query of at least MIN_QUERY_LENGTH characters, or with both.
 *
 * @returns {{ ok: true, priorities: string[], rawQuery: string } | { ok: false, error: string }}
 */
export const validateRefinementInput = (selectedPriorities, rawQuery) => {
  const validIds = PRIORITY_OPTIONS.map((p) => p.id);
  const priorities = (Array.isArray(selectedPriorities) ? selectedPriorities : [])
    .filter((p) => validIds.includes(p));
  const uniquePriorities = [...new Set(priorities)].slice(0, 3);
  const query = (typeof rawQuery === "string" ? rawQuery.trim() : "").slice(0, MAX_QUERY_LENGTH);

  if (uniquePriorities.length === 0 && query.length < MIN_QUERY_LENGTH) {
    return {
      ok: false,
      error: `Select a pillar or describe what you're looking for (at least ${MIN_QUERY_LENGTH} characters).`,
    };
  }

  return { ok: true, priorities: uniquePriorities, rawQuery: query };
};

/**
 * Share of the user's permanent profile vector in the blended search vector
 * (the rest comes from the session embedding). The more the session says in
 * the user's own words, the more it is allowed to steer the search.
 */
export const BLEND_RATIOS = {
  TEXT_ONLY: 0.30,
  TEXT_AND_PILLARS: 0.45,
  PILLARS_ONLY: 0.60,
};

export const getBlendRatio = ({ hasQuery, hasPriorities }) => {
  if (hasQuery && !hasPriorities) return BLEND_RATIOS.TEXT_ONLY;
  if (hasQuery && hasPriorities) return BLEND_RATIOS.TEXT_AND_PILLARS;
  return BLEND_RATIOS.PILLARS_ONLY;
};

/**
 * Maximum cosine distance for pgvector candidates. The default list compares
 * profile to profile; a refined search vector leans toward a short query and
 * sits further from every profile, so the strict cutoff returned nothing.
 */
export const MAX_DISTANCE_DEFAULT = 0.30;
export const MAX_DISTANCE_REFINED = 0.45;

/**
 * Blend two 768-dimensional embedding vectors.
 * Returns a new array: ratio * permanent + (1-ratio) * temporary.
 * Default ratio = 0.60 (60 % permanent, 40 % temporary).
 */
export const blendEmbeddings = (permanentEmbedding, temporaryEmbedding, ratio = 0.60) => {
  if (!permanentEmbedding || !temporaryEmbedding) return permanentEmbedding || temporaryEmbedding || null;
  if (permanentEmbedding.length !== temporaryEmbedding.length) return permanentEmbedding;

  const blended = new Array(permanentEmbedding.length);
  for (let i = 0; i < permanentEmbedding.length; i++) {
    blended[i] = ratio * permanentEmbedding[i] + (1 - ratio) * temporaryEmbedding[i];
  }

  // L2-normalize the blended vector for cosine distance
  let norm = 0;
  for (let i = 0; i < blended.length; i++) norm += blended[i] * blended[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < blended.length; i++) blended[i] /= norm;
  }

  return blended;
};

/**
 * Re-score a suggestion list using adaptive weights.
 * Each suggestion must have a `local_scores` object (or individual score fields).
 * Returns the same array sorted by adjusted_score descending.
 */
export const rescoreSuggestions = (suggestions, adaptiveWeights) => {
  if (!suggestions || suggestions.length === 0) return suggestions;

  return suggestions.map(s => {
    const scores = s.local_scores || s;

    let numerator = 0;
    let denominator = 0;

    const pairs = [
      ["vector_similarity",         scores.vector_similarity],
      ["intent_tag_match",          scores.intent_tag_match],
      ["relationship_expectations", scores.relationship_expectations],
      ["lifestyle_rhythm",          scores.lifestyle_rhythm],
      ["professional_alignment",    scores.professional_alignment],
      ["emotional_tone_match",      scores.emotional_tone_match],
      ["preference_match",          scores.preference_match],
      ["personality_match",         scores.personality_match],
      ["contextual_match",          scores.contextual_match],
    ];

    for (const [key, val] of pairs) {
      const w = adaptiveWeights[key] || 0;
      if (val !== null && val !== undefined) {
        numerator += val * w;
        denominator += w;
      }
    }

    const adjusted_score = denominator > 0 ? Math.round(numerator / denominator) : s.compatibility_score || 0;

    return {
      ...s,
      original_compatibility_score: s.compatibility_score,
      compatibility_score: adjusted_score,
      is_refined: true,
    };
  }).sort((a, b) => b.compatibility_score - a.compatibility_score);
};

// Session TTL: 2 hours in milliseconds
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
