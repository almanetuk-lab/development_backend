import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const extractJsonFromText = (text) => {
  const match = text.match(/```json\n([\s\S]*?)\n```/);
  if (match) return match[1].trim();

  const codeBlockMatch = text.match(/```\n([\s\S]*?)\n```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) return braceMatch[0].trim();

  return null;
};

export const DEFAULT_NORMALIZED_ENTITIES = {
  career_tier: "Professional/Specialist",
  industry_cluster: "General",
  professional_cluster: "General",
  seniority_level: "Mid-Level",
  work_environment: "Standard",
  income_band_estimate: "Average",
  career_stability: "Stable",
  work_intensity: "Balanced",
};

/**
 * Validates and normalizes the parsed JSON from Gemini.
 * Maps missing or unknown values to safe defaults.
 */
export const validateAndNormalizeEntities = (parsed) => {
  if (!parsed || typeof parsed !== "object") {
    return DEFAULT_NORMALIZED_ENTITIES;
  }

  return {
    career_tier: parsed.career_tier || DEFAULT_NORMALIZED_ENTITIES.career_tier,
    industry_cluster: parsed.industry_cluster || DEFAULT_NORMALIZED_ENTITIES.industry_cluster,
    professional_cluster: parsed.professional_cluster || DEFAULT_NORMALIZED_ENTITIES.professional_cluster,
    seniority_level: parsed.seniority_level || DEFAULT_NORMALIZED_ENTITIES.seniority_level,
    work_environment: parsed.work_environment || DEFAULT_NORMALIZED_ENTITIES.work_environment,
    income_band_estimate: parsed.income_band_estimate || DEFAULT_NORMALIZED_ENTITIES.income_band_estimate,
    career_stability: parsed.career_stability || DEFAULT_NORMALIZED_ENTITIES.career_stability,
    work_intensity: parsed.work_intensity || DEFAULT_NORMALIZED_ENTITIES.work_intensity,
  };
};

/**
 * Extracts and normalizes professional data into a semantic JSON structure.
 */
export const extractProfessionalEntities = async (profileData, prompts = null) => {
  let profileTextContext = "";

  if (profileData && typeof profileData === "object") {
    const parts = [];
    if (profileData.profession) parts.push(`Profession/Title: ${profileData.profession}`);
    if (profileData.company_type) parts.push(`Company Type: ${profileData.company_type}`);
    if (profileData.work_environment) parts.push(`Work Environment: ${profileData.work_environment}`);
    if (profileData.about_me) parts.push(`Bio: ${profileData.about_me}`);
    if (profileData.city) parts.push(`City: ${profileData.city}`);
    
    // Add lifestyle text or rhythms if available
    if (profileData.life_rhythms && typeof profileData.life_rhythms === "object") {
      if (profileData.life_rhythms.work_rhythm) parts.push(`Work Rhythm: ${profileData.life_rhythms.work_rhythm}`);
    }

    const activePrompts = prompts || profileData.prompts;
    if (activePrompts && typeof activePrompts === "object") {
      const qas = Object.entries(activePrompts)
        .map(([k, v]) => `Q: ${k} - A: ${v}`)
        .join("\n");
      if (qas) parts.push(`Q&A Prompts:\n${qas}`);
    }
    profileTextContext = parts.join("\n");
  } else {
    profileTextContext = String(profileData || "");
  }

  if (!profileTextContext || profileTextContext.trim().length === 0) {
    console.warn("⚠️ extractProfessionalEntities: empty input, returning defaults.");
    return DEFAULT_NORMALIZED_ENTITIES;
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `You are a Named Entity Recognition (NER) and Professional Normalization Engine.
Your task is to analyze fragmented user professional data (job titles, bio text, work rhythms) and normalize it into standardized semantic clusters.

STRICT RULES:
1. Return ONLY a single JSON object. No markdown, no explanation.
2. Group fragmented titles. For example: "VP of Sales", "Growth Director", "Founder" → "Executive/Leadership".
3. Use the contextual bio to infer the true intensity and stability of their career.

Return EXACTLY this JSON structure:
{
  "career_tier": "Entry-Level | Professional/Specialist | Management | Executive/Leadership | Entrepreneur/Founder | Creative/Freelance | Other",
  "industry_cluster": "Technology | Healthcare | Finance | Education | Arts & Entertainment | Business/Growth | Science | Public Sector | Other",
  "professional_cluster": "Engineering | Sales | Marketing | Leadership | Operations | Design | Legal | Medical | Other",
  "seniority_level": "Junior | Mid-Level | Senior | Principal/Lead | Executive",
  "work_environment": "Startup | Corporate | Remote/Digital Nomad | Hybrid | Field/On-Site | Academic",
  "income_band_estimate": "Average | Above Average | High | Very High",
  "career_stability": "Highly Stable | Stable | Variable | High Risk/High Reward",
  "work_intensity": "Relaxed | Balanced | High Pressure | Extremely Demanding"
}

User Profile Context:
"${profileTextContext.trim()}"

Return the JSON object:`;

    console.log("🤖 Calling Gemini for NER professional entity extraction...");
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const rawText = response.text();

    const jsonString = extractJsonFromText(rawText);
    if (!jsonString) {
      console.error("❌ NER Extraction: Could not locate JSON block.");
      return DEFAULT_NORMALIZED_ENTITIES;
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (parseError) {
      console.error("❌ NER Extraction: JSON.parse failed:", parseError.message);
      return DEFAULT_NORMALIZED_ENTITIES;
    }

    const normalized = validateAndNormalizeEntities(parsed);
    console.log("✅ NER Extraction successful:", normalized);
    return normalized;

  } catch (error) {
    console.error("❌ Gemini API Error in extractProfessionalEntities:", error.message);
    return DEFAULT_NORMALIZED_ENTITIES;
  }
};
