import { pool } from "../config/db.js";
import { logAuditEvent } from "../utils/auditLogger.js";
import { extractIntentTags, enrichContextualMetadata } from "../services/geminiService.js";
import { buildSemanticProfileText, generateEmbedding } from "../services/embeddingService.js";
import { extractProfessionalEntities } from "../services/entityRecognitionService.js";
// Point #9: Sentiment audit + feature flag
import { analyzeSentimentAndTone } from "../services/sentimentAuditService.js";
import { isSentimentAuditEnabled } from "../config/sentimentConfig.js";
// Point #9: Deduplication guard + broadened trigger condition
import {
  acquireRecalcLock,
  releaseRecalcLock,
  hasRecalculatableData,
} from "../services/vectorRecalculationService.js";
import { generateSpiderGraphData } from "../services/spiderGraphService.js";

import { generateOrUpdateTwin } from "../services/digitalTwinService.js";

export const NORMALIZE_ENUMS = {
  gender: {
    Male: "Male",
    Female: "Female",
    "Non-Binary": "Non-Binary",
    Other: "Other",
  },
  marital_status: {
    Single: "Single",
    Married: "Married",
    Divorced: "Divorced",
    Widowed: "Widowed",
    Other: "Other",
    Separated: "Separated",
  },
  interested_in: {
    Man: "Man",
    Woman: "Woman",
    "Non-Binary": "Non-Binary",
    Everyone: "Everyone",
  },
  relationship_goal: {
    "Long-term": "Long-term",
    "Life Partner": "Life Partner",
    "Dating with intent": "Dating with intent",
    Friend: "Friend",
    "Figuring it out": "Figuring it out",
  },
  children_preference: {
    Want: "Want",
    WANT: "Want",
    "Don't want": "Don’t want",
    "Don’t want": "Don’t want",
    DONT_WANT: "Don’t want",
    "Have and want more": "Have and want more",
    HAVE_AND_WANT_MORE: "Have and want more",
    "Have and don't want more": "Have and don’t want more",
    "Have and don’t want more": "Have and don’t want more",
    HAVE_AND_DONT_WANT_MORE: "Have and don’t want more",
    "Open / Not sure yet": "Open / Not Sure yet",
    "Open / Not Sure yet": "Open / Not Sure yet",
    OPEN_OR_NOT_SURE_YET: "Open / Not Sure yet",
  },
  pets_preference: {
    Want: "Want",
    WANT: "Want",
    "Don't want": "Don’t want",
    "Don’t want": "Don’t want",
    DONT_WANT: "Don’t want",
    "Have and want more": "Have and want more",
    HAVE_AND_WANT_MORE: "Have and want more",
    "Have and don't want more": "Have and don’t want more",
    "Have and don’t want more": "Have and don’t want more",
    HAVE_AND_DONT_WANT_MORE: "Have and don’t want more",
    "Open / Not sure yet": "Open / Not sure yet",
    "Open / Not Sure yet": "Open / Not sure yet",
    OPEN_OR_NOT_SURE_YET: "Open / Not sure yet",
  },
  education: {
    "No Formal Education": "No Formal Education",
    "Currently Studying": "Currently Studying",
    "High School": "High School",
    HIGH_SCHOOL: "High School",
    "Vocational / Trade School": "Vocational / Trade School",
    "Associate Degree": "Associate Degree",
    "Bachelors Degree": "Bachelors Degree",
    BACHELORS: "Bachelors Degree",
    Bachelors: "Bachelors Degree",
    "Masters Degree": "Masters Degree",
    MASTERS: "Masters Degree",
    Master: "Masters Degree",
    Doctorate: "Doctorate",
    PHD: "Doctorate",
  },
  smoking: {
    No: "No",
    NO: "No",
    Yes: "Yes",
    YES: "Yes",
    Socially: "Socially",
    SOCIAL: "Socially",
  },
  drinking: {
    No: "No",
    NO: "No",
    Yes: "Yes",
    YES: "Yes",
    Socially: "Socially",
    SOCIAL: "Socially",
  },
  work_rhythm: {
    Regular: "Structured routine",
    "Structured routine": "Structured routine",
    Flexible: "Balanced with busy phases",
    "Balanced with busy phases": "Balanced with busy phases",
    Intense: "High intensity",
    "High intensity": "High intensity",
    Unpredictable: "Unpredictable",
    Seasonal: "Project-based",
    "Project-based": "Project-based",
    "Travel-heavy": "Travel-heavy",
  },
  career_decision_style: {
    Analytical: "Security-focused",
    "Security-focused": "Security-focused",
    Collaborative: "Balanced",
    Balanced: "Balanced",
    Intuitive: "Opportunity-driven",
    "Opportunity-driven": "Opportunity-driven",
    Independent: "Risk-positive",
    "Risk-positive": "Risk-positive",
  },
  work_demand_response: {
    Proactive: "Adjusting plans quickly",
    "Adjusting plans quickly": "Adjusting plans quickly",
    Reactive: "Keeping structure",
    "Keeping structure": "Keeping structure",
    Balanced: "Taking space to rebalance",
    "Taking space to rebalance": "Taking space to rebalance",
    Selective: "Communicating clearly and finding a middle ground",
    "Communicating clearly and finding a middle ground": "Communicating clearly and finding a middle ground",
  },
  preference_of_closeness: {
    High: "More time together",
    "More time together": "More time together",
    Medium: "A mix of space and closeness",
    "A mix of space and closeness": "A mix of space and closeness",
    Low: "Regular personal time",
    "Regular personal time": "Regular personal time",
    Variable: "Not yet sure",
    "Not yet sure": "Not yet sure",
    "Open / Not yet sure": "Not yet sure",
    "Open / Not Sure yet": "Not yet sure",
  },
  professional_identity: {
    "Corporate Professional": "Corporate Professional",
    PROFESSIONAL: "Corporate Professional",
    Entrepreneur: "Entrepreneur",
    ENTREPRENEUR: "Entrepreneur",
    "Startup Founder": "Startup Founder",
    Freelancer: "Freelancer",
    FREELANCER: "Freelancer",
    "Consultant Trader": "Consultant Trader",
    Consultant: "Consultant Trader",
    Trader: "Consultant Trader",
    Investor: "Investor",
    "Family Business Owner": "Family Business Owner",
    "Small Business Owner": "Small Business Owner",
    "Creative Professional": "Creative Professional",
    "Healthcare Professional": "Healthcare Professional",
    "Public Service": "Public Service",
    Government: "Government",
    Student: "Student",
    STUDENT: "Student",
    Other: "Other",
  },
  freetime_style: {
    "Mostly social": "Mostly social",
    "With Partner": "With Partner",
    "Balanced mix": "Balanced mix",
    "Low-key and restful": "Low-key and restful",
  },
  health_activity_level: {
    Active: "Active",
    "Semi-active": "Semi-active",
    Light: "Light",
    Minimal: "Minimal",
  },
  self_expression: {
    "Clear and direct": "Clear and direct",
    "Reflective and calm": "Reflective and calm",
    "Expressive once I trust": "Expressive once I trust",
    "Reserved until I feel safe": "Reserved until I feel safe",
  },
  interaction_style: {
    "Light and engaging": "Light and engaging",
    "Deep and thought-provoking": "Deep and thought-provoking",
    "Reserved unless invited": "Reserved unless invited",
    Other: "Other",
  },
  work_environment: {
    Remote: "Remote",
    Hybrid: "Hybrid",
    "Office/Location based": "Office/Location based",
    "On-the-go": "On-the-go",
    Other: "Other",
  },
  relationship_values: {
    Growth: "Growth",
    Stability: "Stability",
    "Emotional openness": "Emotional openness",
    "Shared rhythm": "Shared rhythm",
    "Practical harmony": "Practical harmony",
  },
  values_in_others: {
    "Self-awareness": "Self-awareness",
    "Emotional intelligence": "Emotional intelligence",
    Ambition: "Ambition",
    Kindness: "Kindness",
    Humour: "Humour",
  },
  relationship_pace: {
    Naturally: "Naturally",
    Quickly: "Quickly",
    Slowly: "Slowly",
    "With clear definition": "With clear definition",
  },
  love_language_affection: {
    "Physical Touch": "Physical Touch",
    "Words of Affirmation": "Words of Affirmation",
    "Quality Time": "Quality Time",
    "Acts of Service": "Acts of Service",
    "Thoughtful Gifts": "Thoughtful Gifts",
  },
  approach_to_physical_closeness: {
    "Gradual build-up": "Gradual build-up",
    "Connect early if aligned": "Connect early if aligned",
    "Emotional-first": "Emotional-first",
    "Emotional + physical balanced": "Emotional + physical balanced",
    "Prefer more time": "Prefer more time",
  },
  religious_belief: {
    Hindu: "Hindu",
    Muslim: "Muslim",
    Christian: "Christian",
    Sikh: "Sikh",
    Buddhist: "Buddhist",
    Jain: "Jain",
    Jewish: "Jewish",
    Spiritual: "Spiritual",
    Atheist: "Agnostic",
    Agnostic: "Agnostic",
    Other: "Other",
    "Prefer not to say": "Prefer not to say",
  },
};

export const cleanEnum = (field, val) => {
  if (val === undefined || val === null) return null;
  if (typeof val !== "string") return val;
  const trimmed = val.trim();
  if (trimmed === "") return null;
  if (NORMALIZE_ENUMS[field] && NORMALIZE_ENUMS[field][trimmed]) {
    return NORMALIZE_ENUMS[field][trimmed];
  }
  return trimmed;
};

// 🟢 Update Profile 
export const updateProfile = async (req, res) => {
  try {
    const {
      email,
      first_name,
      last_name,
      headline,
      phone,
      dob,
      age,
      education,
      company,
      experience,
      gender,
      marital_status,
      address,
      profession,
      skills,
      interests,
      about,
      city,
      state,
      country,
      pincode,
      company_type,
      position,
      hobbies,
      professional_identity,
      interested_in,
      relationship_goal,
      children_preference,
      education_institution_name,
      languages_spoken,
      zodiac_sign,
      self_expression,
      freetime_style,
      health_activity_level,
      pets_preference,
      religious_belief,
      smoking,
      drinking,
      work_environment,
      interaction_style,
      work_rhythm,
      career_decision_style,
      work_demand_response,
      love_language_affection,
      preference_of_closeness,
      approach_to_physical_closeness,
      relationship_values,
      values_in_others,
      relationship_pace,
      height_ft,
      height_in,
      life_rhythms,
      ways_i_spend_time,
      prompts,
      about_me,
      latitude,
      longitude,
    } = req.body;

    // Required Fields Validation (only email, first_name, last_name are universally mandatory)
    if (!email || !first_name || !last_name) {
      return res.status(400).json({
        error: "Email, First name, and Last name are required.",
        message: "Email, First name, and Last name are required",
      });
    }

    const userId = req.user.id;
    // Check if dob and age already exist in database for this user
    const existingProfile = await pool.query("SELECT dob, age FROM profiles WHERE user_id = $1", [userId]);
    const hasExistingDob = existingProfile.rows.length > 0 && existingProfile.rows[0].dob;

    if (hasExistingDob && (!dob || age === undefined || age === null || age === "")) {
      return res.status(400).json({
        error: "Date of Birth and Age cannot be cleared once they are set.",
        message: "Date of Birth and Age are required",
      });
    }

    // Sanitize values
    const clean_first_name = typeof first_name === "string" ? first_name.trim() : "";
    const clean_last_name = typeof last_name === "string" ? last_name.trim() : "";
    const clean_email = typeof email === "string" ? email.trim() : "";
    const clean_username = typeof username === "string" ? username.trim().toLowerCase() : "";

    // Normalize all dropdown/enum fields to DB format
    const normalized_gender = cleanEnum("gender", gender);
    const normalized_marital_status = cleanEnum("marital_status", marital_status);
    const normalized_professional_identity = cleanEnum("professional_identity", professional_identity);
    const normalized_company_type = cleanEnum("company_type", company_type);
    const normalized_education = cleanEnum("education", education);
    const normalized_freetime_style = cleanEnum("freetime_style", freetime_style);
    const normalized_health_activity_level = cleanEnum("health_activity_level", health_activity_level);
    const normalized_smoking = cleanEnum("smoking", smoking);
    const normalized_drinking = cleanEnum("drinking", drinking);
    const normalized_pets_preference = cleanEnum("pets_preference", pets_preference);
    const normalized_religious_belief = cleanEnum("religious_belief", religious_belief);
    const normalized_interested_in = cleanEnum("interested_in", interested_in);
    const normalized_relationship_goal = cleanEnum("relationship_goal", relationship_goal);
    const normalized_children_preference = cleanEnum("children_preference", children_preference);
    const normalized_self_expression = cleanEnum("self_expression", self_expression);
    const normalized_interaction_style = cleanEnum("interaction_style", interaction_style);
    const normalized_work_environment = cleanEnum("work_environment", work_environment);
    const normalized_work_rhythm = cleanEnum("work_rhythm", work_rhythm);
    const normalized_career_decision_style = cleanEnum("career_decision_style", career_decision_style);
    const normalized_work_demand_response = cleanEnum("work_demand_response", work_demand_response);
    const normalized_preference_of_closeness = cleanEnum("preference_of_closeness", preference_of_closeness);
    const normalized_love_language_affection = cleanEnum("love_language_affection", love_language_affection);
    const normalized_approach_to_physical_closeness = cleanEnum("approach_to_physical_closeness", approach_to_physical_closeness);
    const normalized_relationship_values = cleanEnum("relationship_values", relationship_values);
    const normalized_values_in_others = cleanEnum("values_in_others", values_in_others);
    const normalized_relationship_pace = cleanEnum("relationship_pace", relationship_pace);

    // 1. Core Profile Details Validation
    if (clean_first_name.length < 2 || clean_first_name.length > 50) {
      return res.status(400).json({ error: "First name must be between 2 and 50 characters.", message: "First name must be between 2 and 50 characters." });
    }
    const nameRegex = /^[a-zA-Z\s\-]+$/;
    if (!nameRegex.test(clean_first_name)) {
      return res.status(400).json({ error: "First name can only contain letters, spaces, and hyphens.", message: "First name can only contain letters, spaces, and hyphens." });
    }

    if (clean_last_name.length < 2 || clean_last_name.length > 50) {
      return res.status(400).json({ error: "Last name must be between 2 and 50 characters.", message: "Last name must be between 2 and 50 characters." });
    }
    if (!nameRegex.test(clean_last_name)) {
      return res.status(400).json({ error: "Last name can only contain letters, spaces, and hyphens.", message: "Last name can only contain letters, spaces, and hyphens." });
    }

    if (clean_email.length > 100) {
      return res.status(400).json({ error: "Email address cannot exceed 100 characters.", message: "Email address cannot exceed 100 characters." });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+.[^\s@]+$/;
    if (!emailRegex.test(clean_email)) {
      return res.status(400).json({ error: "Please enter a valid email address.", message: "Please enter a valid email address." });
    }

    if (clean_username) {
      const usernameRegex = /^(?!.*\.\.)(?!\.)(?!.*\.$)[a-z0-9._]{3,30}$/;
      if (!usernameRegex.test(clean_username)) {
        return res.status(400).json({
          error: "Username must be 3–30 characters, lowercase, and can contain letters, numbers, dots (.), or underscores (_).",
          message: "Username must be 3–30 characters, lowercase, and can contain letters, numbers, dots (.), or underscores (_).",
        });
      }
    }

    if (dob) {
      const dobDate = new Date(dob);
      const today = new Date();
      if (dobDate >= today) {
        return res.status(400).json({ error: "Date of Birth must be in the past.", message: "Date of Birth must be in the past." });
      }
      let calculatedAge = today.getFullYear() - dobDate.getFullYear();
      const monthDiff = today.getMonth() - dobDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dobDate.getDate())) {
        calculatedAge--;
      }
      if (calculatedAge < 18) {
        return res.status(400).json({ error: "You must be at least 18 years old.", message: "You must be at least 18 years old." });
      }
    }

    if (age !== undefined && age !== null && age !== "") {
      const ageNum = Number(age);
      if (isNaN(ageNum) || ageNum < 18 || ageNum > 120) {
        return res.status(400).json({ error: "Age must be a valid number between 18 and 120.", message: "Age must be a valid number between 18 and 120." });
      }
    }

    // 2. Optional Fields Formats & Lengths Validation
    if (phone) {
      const clean_phone = String(phone).trim();
      if (!/^[+0-9\s\-()]+$/.test(clean_phone)) {
        return res.status(400).json({ error: "Phone number can only contain digits, spaces, hyphens, parentheses, and +.", message: "Phone number can only contain digits, spaces, hyphens, parentheses, and +." });
      }
      const digitsCount = clean_phone.replace(/[^0-9]/g, "").length;
      if (digitsCount < 7 || digitsCount > 15) {
        return res.status(400).json({ error: "Phone number should be between 7 and 15 digits long.", message: "Phone number should be between 7 and 15 digits long." });
      }
    }

    // Length Checks
    const maxLimits = [
      { name: "headline", val: headline, max: 200 },
      { name: "company", val: company, max: 100 },
      { name: "position", val: position, max: 100 },
      { name: "profession", val: profession, max: 100 },
      { name: "city", val: city, max: 100 },
      { name: "state", val: state, max: 100 },
      { name: "country", val: country, max: 100 },
      { name: "pincode", val: pincode, max: 20 },
      { name: "address", val: address, max: 500 },
      { name: "education_institution_name", val: education_institution_name, max: 150 },
      { name: "zodiac_sign", val: zodiac_sign, max: 50 },
      { name: "about", val: about, max: 1000 },
      { name: "about_me", val: about_me, max: 1000 },
    ];
    for (const item of maxLimits) {
      if (item.val && typeof item.val === "string" && item.val.length > item.max) {
        return res.status(400).json({ error: `${item.name} cannot exceed ${item.max} characters.`, message: `${item.name} cannot exceed ${item.max} characters.` });
      }
    }

    // Numeric checks
    if (experience !== undefined && experience !== null && experience !== "") {
      const expNum = Number(experience);
      if (isNaN(expNum) || expNum < 0 || expNum > 80) {
        return res.status(400).json({ error: "Experience must be a number between 0 and 80.", message: "Experience must be a number between 0 and 80." });
      }
    }

    if (latitude !== undefined && latitude !== null && latitude !== "") {
      const lat = Number(latitude);
      if (isNaN(lat) || lat < -90 || lat > 90) {
        return res.status(400).json({ error: "Latitude must be between -90 and 90.", message: "Latitude must be between -90 and 90." });
      }
    }

    if (longitude !== undefined && longitude !== null && longitude !== "") {
      const lon = Number(longitude);
      if (isNaN(lon) || lon < -180 || lon > 180) {
        return res.status(400).json({ error: "Longitude must be between -180 and 180.", message: "Longitude must be between -180 and 180." });
      }
    }

    // 3. Dropdowns (Enums) Validation
    const enumValidations = [
      { name: "gender", val: normalized_gender, list: ["Male", "Female", "Non-Binary", "Other"] },
      { name: "marital_status", val: normalized_marital_status, list: ["Single", "Married", "Divorced", "Widowed", "Other", "Separated"] },
      { name: "professional_identity", val: normalized_professional_identity, list: ["Corporate Professional", "Entrepreneur", "Startup Founder", "Freelancer", "Consultant Trader", "Investor", "Family Business Owner", "Small Business Owner", "Creative Professional", "Healthcare Professional", "Public Service", "Government", "Student", "Other"] },
      { name: "company_type", val: normalized_company_type, list: ["MNC", "Startup", "SME", "Government", "NGO", "Other"] },
      { name: "education", val: normalized_education, list: ["No Formal Education", "Currently Studying", "High School", "Vocational / Trade School", "Associate Degree", "Bachelors Degree", "Masters Degree", "Doctorate"] },
      { name: "freetime_style", val: normalized_freetime_style, list: ["Mostly social", "With Partner", "Balanced mix", "Low-key and restful"] },
      { name: "health_activity_level", val: normalized_health_activity_level, list: ["Active", "Semi-active", "Light", "Minimal"] },
      { name: "smoking", val: normalized_smoking, list: ["No", "Yes", "Socially"] },
      { name: "drinking", val: normalized_drinking, list: ["No", "Yes", "Socially"] },
      { name: "pets_preference", val: normalized_pets_preference, list: ["Want", "Don’t want", "Don't want", "Have and want more", "Have and don’t want more", "Have and don't want more", "Open / Not sure yet", "Open / Not Sure yet"] },
      { name: "religious_belief", val: normalized_religious_belief, list: ["Hindu", "Muslim", "Christian", "Sikh", "Buddhist", "Jain", "Jewish", "Spiritual", "Atheist", "Agnostic", "Other", "Prefer not to say"] },
      { name: "interested_in", val: normalized_interested_in, list: ["Man", "Woman", "Non-Binary", "Everyone"] },
      { name: "relationship_goal", val: normalized_relationship_goal, list: ["Long-term", "Life Partner", "Dating with intent", "Friend", "Figuring it out"] },
      { name: "children_preference", val: normalized_children_preference, list: ["Want", "Don’t want", "Don't want", "Have and want more", "Have and don’t want more", "Have and don't want more", "Open / Not Sure yet", "Open / Not sure yet"] },
      { name: "self_expression", val: normalized_self_expression, list: ["Clear and direct", "Reflective and calm", "Expressive once I trust", "Reserved until I feel safe"] },
      { name: "interaction_style", val: normalized_interaction_style, list: ["Light and engaging", "Deep and thought-provoking", "Reserved unless invited", "Other"] },
      { name: "work_environment", val: normalized_work_environment, list: ["Remote", "Hybrid", "Office/Location based", "On-the-go", "Other"] },
      { name: "work_rhythm", val: normalized_work_rhythm, list: ["Structured routine", "Balanced with busy phases", "High intensity", "Unpredictable", "Project-based", "Travel-heavy"] },
      { name: "career_decision_style", val: normalized_career_decision_style, list: ["Security-focused", "Balanced", "Opportunity-driven", "Risk-positive"] },
      { name: "work_demand_response", val: normalized_work_demand_response, list: ["Adjusting plans quickly", "Keeping structure", "Taking space to rebalance", "Communicating clearly and finding a middle ground"] },
      { name: "preference_of_closeness", val: normalized_preference_of_closeness, list: ["More time together", "A mix of space and closeness", "Regular personal time", "Not yet sure"] },
      { name: "love_language_affection", val: normalized_love_language_affection, list: ["Physical Touch", "Words of Affirmation", "Quality Time", "Acts of Service", "Thoughtful Gifts"] },
    ];
    for (const item of enumValidations) {
      if (item.val && item.val !== "") {
        if (!item.list.includes(item.val)) {
          return res.status(400).json({ error: `Invalid selection for ${item.name}.`, message: `Invalid selection for ${item.name}.` });
        }
      }
    }

    console.log("ABOUT ME:", about_me);
    const imageUrl = req.file ? req.file.path : null;

    // HEIGHT LOGIC (ONLY ONE COLUMN)
    // =========================
    let height = null;

    const hasFt = height_ft !== undefined && height_ft !== null && height_ft !== "";
    const hasIn = height_in !== undefined && height_in !== null && height_in !== "";

    if (hasFt && hasIn) {
      const ft = Number(height_ft);
      const inch = Number(height_in);

      if (Number.isNaN(ft) || Number.isNaN(inch) || ft < 3 || ft > 8 || inch < 0 || inch > 11) {
        return res.status(400).json({ error: "Invalid height values. Feet must be between 3 and 8, inches must be between 0 and 11.", message: "Invalid height" });
      }

      height = ft * 12 + inch;
    } else if (hasFt || hasIn) {
      return res.status(400).json({
        error: "Both height_ft and height_in are required if setting height.",
        message: "Both height_ft and height_in are required",
      });
    }

    // --- DEEP LOGGING INITIATED ---
    console.log("==================================================");
    console.log("🛠️  PROFILE UPDATE PIPELINE INITIATED");
    console.log("[DEBUG] Profile Update Started");
    console.log("USER ID (from token):", userId);
    console.log("ABOUT ME RECEIVED:", about_me);
    console.log("==================================================");

    // --- Gemini Intent & Contextual Enrichment Pipeline ---
    let intent_tags = null;
    let confidence_score = null;
    let contextual_tags = null;
    let intent_embedding = null;
    let semanticText = null;
    let normalized_entities = null;
    let sentiment_audit = null; // Point #9: Sentiment & tone audit result
    let spider_graph_data = null; // Point #10: Spider Graph Data

    // Point #9: Broadened trigger — fires on ANY field that influences intent,
    // lifestyle, rhythm, stress cycle, social preference, sentiment, or profession.
    const hasData = hasRecalculatableData({
      about_me, profession, prompts,
      relationship_goal, relationship_values, life_rhythms,
      work_environment, work_rhythm, health_activity_level,
      religious_belief, freetime_style, smoking, drinking,
      city, company, company_type, interested_in,
      relationship_pace, love_language_affection,
      self_expression, career_decision_style, work_demand_response,
    });

    if (hasData) {
      // ── Point #9: Deduplication guard ────────────────────────────────────────
      // Prevents concurrent embedding regeneration for the same user.
      // If a recalculation is already running (e.g., rapid duplicate saves),
      // skip the AI pipeline this time — the existing DB values are preserved.
      const lockAcquired = acquireRecalcLock(userId);
      if (!lockAcquired) {
        console.log(`⏭️  [ProfileUpdate] Recalculation already in progress for user ${userId} — AI pipeline skipped this call.`);
      } else {
        try {
          const profileData = {
            // Personal Identity
            first_name: clean_first_name,
            last_name: clean_last_name,
            age,
            gender: normalized_gender,
            zodiac_sign,
            marital_status: normalized_marital_status,
            languages_spoken,
            city,
            state,
            country,
            // Education
            education: normalized_education,
            education_institution_name,
            // Professional
            profession,
            company,
            company_type: normalized_company_type,
            experience,
            position,
            professional_identity: normalized_professional_identity,
            skills,
            // Work rhythm
            work_environment: normalized_work_environment,
            work_rhythm: normalized_work_rhythm,
            career_decision_style: normalized_career_decision_style,
            work_demand_response: normalized_work_demand_response,
            interaction_style: normalized_interaction_style,
            // Interests & hobbies
            interests,
            hobbies,
            ways_i_spend_time,
            // Relationship & partner preferences
            relationship_goal: normalized_relationship_goal,
            relationship_values: normalized_relationship_values,
            relationship_pace: normalized_relationship_pace,
            love_language_affection: normalized_love_language_affection,
            interested_in: normalized_interested_in,
            values_in_others: normalized_values_in_others,
            self_expression: normalized_self_expression,
            preference_of_closeness: normalized_preference_of_closeness,
            approach_to_physical_closeness: normalized_approach_to_physical_closeness,
            children_preference: normalized_children_preference,
            // Lifestyle & personality
            freetime_style: normalized_freetime_style,
            health_activity_level: normalized_health_activity_level,
            pets_preference: normalized_pets_preference,
            religious_belief: normalized_religious_belief,
            smoking: normalized_smoking,
            drinking: normalized_drinking,
            // Life rhythms JSONB
            life_rhythms,
            // Bio
            about_me,
          };

          // Step 1: NER — Normalized Professional Entities
          console.log("🤖 [ProfileUpdate] Step 1: Generating normalized entities...");
          try {
            normalized_entities = await extractProfessionalEntities(profileData, prompts);
            console.log("🤖 GENERATED normalized_entities:", normalized_entities);
          } catch (nerError) {
            console.error("❌ NER extraction failed:", nerError.message);
            normalized_entities = null;
          }

          // Step 2: Intent Tags + Confidence Score
          console.log("🤖 [ProfileUpdate] Step 2: Generating intent tags and confidence score...");
          try {
            const geminiResult = await extractIntentTags(profileData, prompts);
            intent_tags = geminiResult.intent_tags;
            confidence_score = geminiResult.confidence_score;
            console.log("🤖 GENERATED intent_tags:", intent_tags);
            console.log("🤖 GENERATED confidence_score:", confidence_score);
          } catch (geminiError) {
            console.error("❌ Gemini intent tag extraction failed:", geminiError.message);
            intent_tags = {
              ambition_level: "Moderate",
              stress_cycle: "Balanced",
              social_preference: "Moderate",
              communication_style: "Friendly",
              relationship_intent: "Meaningful",
            };
            confidence_score = 0.50;
          }

          // Step 3: Contextual Metadata Enrichment
          console.log("🤖 [ProfileUpdate] Step 3: Generating contextual metadata tags...");
          try {
            contextual_tags = await enrichContextualMetadata(profileData, prompts);
            console.log("🤖 GENERATED contextual_tags:", contextual_tags);
          } catch (contextError) {
            console.error("❌ Gemini contextual metadata enrichment failed:", contextError.message);
            contextual_tags = {
              city_energy: "Moderate",
              cost_of_living: "Moderate",
              career_pressure: "Moderate",
              commute_stress: "Moderate",
              social_environment: "Balanced",
              emotional_environment: "Balanced",
              lifestyle_intensity: "Balanced"
            };
          }

          // Step 4: Sentiment Audit (Point #9 — feature-flag gated)
          if (isSentimentAuditEnabled()) {
            console.log("🧠 [ProfileUpdate] Step 4: Running sentiment audit...");
            try {
              const sentimentProfile = {
                about_me,
                profession,
                work_environment,
                work_rhythm,
                relationship_goal,
                relationship_values,
                life_rhythms,
                freetime_style,
                health_activity_level,
              };
              sentiment_audit = await analyzeSentimentAndTone(sentimentProfile, prompts);
              console.log(`🧠 [ProfileUpdate] Sentiment: tone=${sentiment_audit?.primary_tone}, stress=${sentiment_audit?.stress_level}, resilience=${sentiment_audit?.emotional_resilience}`);
            } catch (sentimentError) {
              console.error("❌ Sentiment audit failed (non-fatal):", sentimentError.message);
              sentiment_audit = null;
            }
          } else {
            console.log("ℹ️  [ProfileUpdate] Step 4: Sentiment audit SKIPPED (ENABLE_SENTIMENT_AUDIT=false).");
          }

          // Step 4.5: Spider Graph Data Generation (Point #10)
          console.log("🕸️  [ProfileUpdate] Step 4.5: Generating spider graph data...");
          try {
            spider_graph_data = generateSpiderGraphData(
              intent_tags,
              contextual_tags,
              sentiment_audit,
              normalized_entities
            );
            console.log(`🕸️ [ProfileUpdate] Spider Graph: Professional=${spider_graph_data.professional_alignment}, Lifestyle=${spider_graph_data.lifestyle_sync}, Emotional=${spider_graph_data.emotional_readiness}`);
          } catch (spiderError) {
            console.error("❌ Spider graph generation failed:", spiderError.message);
            spider_graph_data = null;
          }

          // Step 5: Semantic Profile Text + Embedding
          console.log("🤖 [ProfileUpdate] Step 5: Generating semantic profile text + embedding...");
          const fullProfileForEmbedding = {
            ...profileData,
            contextual_tags_parsed: contextual_tags,
            normalized_entities,
            // interests/hobbies need parsed variants for embeddingService
            interests_parsed: typeof interests === "object" ? interests : null,
            hobbies_parsed: typeof hobbies === "object" ? hobbies : null,
            prompts,
          };
          semanticText = buildSemanticProfileText(fullProfileForEmbedding, intent_tags);
          console.log("🤖 Semantic Profile Text:", semanticText);

          console.log("🤖 Generating intent embedding vector...");
          try {
            intent_embedding = await generateEmbedding(semanticText);
            console.log(`✅ Embedding generated: ${intent_embedding ? intent_embedding.length + "d" : "null (failed)"}`);
          } catch (embedError) {
            console.error("❌ Generating embedding failed:", embedError.message);
          }

        } finally {
          // Always release the deduplication lock — even if an error occurs
          releaseRecalcLock(userId);
          console.log(`🔓 [ProfileUpdate] Recalculation lock released for user ${userId}`);
        }
      }
    } else {
      console.log("ℹ️ No significant profile data provided — AI tags and embeddings will not be updated.");
    }

    const updateProfileQuery = `
      UPDATE profiles
      SET 
        first_name = $1,
        last_name = $2,
        phone = $3,
        gender = $4,
        marital_status = $5,
        address = $6,
        profession = $7,
        skills = $8,
        interests = $9,
        about = $10,
        city = $11,
        state = $12,
        country = $13,
        pincode = $14,
        headline = $15,
        dob = $16,
        age = $17,
        education = $18,
        company = $19,
        company_type = $20,
        experience = $21,
        position = $22,
        hobbies = $23,
        professional_identity = $24,
        interested_in = $25,
        relationship_goal = $26,
        children_preference = $27,
        education_institution_name = $28,
        languages_spoken = $29,
        zodiac_sign = $30,
        self_expression = $31,
        freetime_style = $32,
        health_activity_level = $33,
        pets_preference = $34,
        religious_belief = $35,
        smoking = $36,
        drinking = $37,
        work_environment = $38,
        interaction_style = $39,
        work_rhythm = $40,
        career_decision_style = $41,
        work_demand_response = $42,
        love_language_affection = $43,
        preference_of_closeness = $44,
        approach_to_physical_closeness = $45,
        relationship_values = $46,
        values_in_others = $47,
        relationship_pace = $48,
        height = $49,
        life_rhythms = $50,
        about_me = COALESCE($51, about_me),
        ways_i_spend_time = $52,
        image_url = COALESCE($53, image_url),
        intent_tags = COALESCE($54::jsonb, intent_tags),
        contextual_tags = COALESCE($58::jsonb, contextual_tags),
        normalized_entities = COALESCE($59::jsonb, normalized_entities),
        sentiment_audit     = COALESCE($60::jsonb, sentiment_audit),
        spider_graph_data   = COALESCE($61::jsonb, spider_graph_data),
        updated_at = NOW(),
        is_submitted = true,
        intent_embedding = COALESCE($56::vector, intent_embedding),
        confidence_score = COALESCE($57::float8, confidence_score)
      WHERE user_id = $55
      RETURNING *;
    `;

    const profileValues = [
      clean_first_name,
      clean_last_name,
      phone || null,
      normalized_gender || null,
      normalized_marital_status || null,
      address || null,
      profession || null,
      JSON.stringify(skills || {}),
      JSON.stringify(interests || {}),
      about || null,
      city || null,
      state || null,
      country || null,
      pincode || null,
      headline || null,
      dob || null,
      age || null,
      normalized_education || null,
      company || null,
      normalized_company_type || null,
      experience !== undefined && experience !== null && experience !== "" ? Number(experience) : null,
      position || null,
      JSON.stringify(hobbies || {}),
      normalized_professional_identity || null,
      normalized_interested_in || null,
      normalized_relationship_goal || null,
      normalized_children_preference || null,
      education_institution_name || null,
      languages_spoken || null, // text[] — pass as array
      zodiac_sign || null,
      normalized_self_expression || null,
      normalized_freetime_style || null,
      normalized_health_activity_level || null,
      normalized_pets_preference || null,
      normalized_religious_belief || null,
      normalized_smoking || null,
      normalized_drinking || null,
      normalized_work_environment || null,
      normalized_interaction_style || null,
      normalized_work_rhythm || null,
      normalized_career_decision_style || null,
      normalized_work_demand_response || null,
      normalized_love_language_affection || null, // enum — pass as enum string
      normalized_preference_of_closeness || null,
      normalized_approach_to_physical_closeness || null,
      normalized_relationship_values || null,
      normalized_values_in_others || null,
      normalized_relationship_pace || null,
      height,
      JSON.stringify(life_rhythms || {}),
      about_me || null,
      JSON.stringify(ways_i_spend_time || {}),
      imageUrl,
      intent_tags ? JSON.stringify(intent_tags) : null, // null → COALESCE keeps existing DB value
      userId,
      intent_embedding ? JSON.stringify(intent_embedding) : null, // $56
      confidence_score !== null && confidence_score !== undefined ? confidence_score : null, // $57
      contextual_tags ? JSON.stringify(contextual_tags) : null, // $58
      normalized_entities ? JSON.stringify(normalized_entities) : null, // $59
      sentiment_audit ? JSON.stringify(sentiment_audit) : null, // $60 — Point #9
      spider_graph_data ? JSON.stringify(spider_graph_data) : null, // $61 — Point #10
    ];
    console.log("=========================================");
    console.log("🤖 PROFILE UPDATE PIPELINE PIPELINE LOGS");
    console.log("USER ID:", req.user.id);
    console.log("ABOUT ME RECEIVED:", about_me);
    console.log("GENERATED INTENT TAGS:", intent_tags ? JSON.stringify(intent_tags) : "null");
    console.log("GENERATED CONFIDENCE SCORE:", confidence_score);
    console.log("SEMANTIC TEXT:", semanticText);
    console.log("EMBEDDING DIMENSIONS COUNT:", intent_embedding ? intent_embedding.length : 0);
    console.log("FINAL SQL PARAMS:", profileValues);
    console.log("=========================================");

    if (latitude !== undefined && longitude !== undefined) {
      const lat = Number(latitude);
      const lon = Number(longitude);
      if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        const pointWkt = `POINT(${lon} ${lat})`;
        await pool.query(
          `UPDATE profiles SET location = ST_GeographyFromText($1) WHERE user_id = $2`,
          [pointWkt, userId]
        );
      }
    }

    const profileResult = await pool.query(updateProfileQuery, profileValues);


    // Invalidate compatibility cache for this updated profile
    console.log(`🧬 Profile updated. Invalidating compatibility cache for user ID ${userId}...`);
    try {
      await pool.query("DELETE FROM profile_compatibilities WHERE user_a_id = $1 OR user_b_id = $1", [userId]);
      console.log(`🧬 Successfully deleted cached compatibilities containing user ID ${userId}.`);
    } catch (cacheErr) {
      console.error("❌ Failed to clear compatibility cache on profile update:", cacheErr.message);
    }

    console.log("==================================================");
    if (profileResult.rows.length > 0) {
      console.log("✅ PROFILE UPDATED SUCCESSFULLY IN DB");
      console.log("PROFILE ID:", profileResult.rows[0].id);
      console.log("SAVED ABOUT ME:", profileResult.rows[0].about_me);
      console.log("SAVED INTENT TAGS:", profileResult.rows[0].intent_tags ? "Present" : "Null");
      console.log("SAVED CONFIDENCE SCORE:", profileResult.rows[0].confidence_score);
      console.log("DB SAVE SUCCESS: true");

      // 🧠 Trigger Digital Twin Generation Asynchronously
      console.log("[DEBUG] Twin Data Check Started");
      const hasTwinData = about_me || life_rhythms || prompts || profession || relationship_goal || intent_tags || contextual_tags || normalized_entities || sentiment_audit;
      console.log("[DEBUG] hasTwinData Result:", Boolean(hasTwinData), { about_me: !!about_me, life_rhythms: !!life_rhythms, prompts: !!prompts, profession: !!profession, relationship_goal: !!relationship_goal });
      
      if (hasTwinData) {
        console.log(`[DEBUG] Triggering Digital Twin Generation`);
        console.log(`[DEBUG] User ID: ${userId}`);
        console.log(`[DEBUG] Profile Data Received:`, JSON.stringify({ about_me, profession, relationship_goal }));
        
        generateOrUpdateTwin(userId, profileResult.rows[0], {
          intent_tags: intent_tags || profileResult.rows[0].intent_tags,
          contextual_tags: contextual_tags || profileResult.rows[0].contextual_tags,
          normalized_entities: normalized_entities || profileResult.rows[0].normalized_entities,
          sentiment_audit: sentiment_audit || profileResult.rows[0].sentiment_audit,
          spider_graph_data: spider_graph_data || profileResult.rows[0].spider_graph_data,
          prompts: prompts
        }).catch(err => console.error("❌ Asynchronous Twin generation failed:", err));
      }
    } else {
      console.log("❌ PROFILE UPDATE FAILED: No row returned");
    }
    console.log("==================================================");

    if (!profileResult.rows.length) {
      return res.status(404).json({ message: "Profile not found" });
    }

    let savedPrompts = [];
    if (
      prompts &&
      typeof prompts === "object" &&
      Object.keys(prompts).length > 0
    ) {
      savedPrompts = await saveOrUpdateProfilePrompts(
        profileResult.rows[0].id,
        prompts,
      );
    }

    const updateUserQuery = `
      UPDATE users
      SET email = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, email;
    `;
    const userResult = await pool.query(updateUserQuery, [email, userId]);

    if (!userResult.rows.length) {
      return res.status(404).json({ message: "User not found" });
    }

    // Optionally remove sensitive or unwanted fields from response
    const {
      dob: removedDob,
      age: removedAge,
      ...safeProfile
    } = profileResult.rows[0];

    const profileWithPrompts = {
      ...safeProfile,
      latitude: latitude !== undefined ? Number(latitude) : null,
      longitude: longitude !== undefined ? Number(longitude) : null,
      prompts: savedPrompts.reduce((acc, cur) => {
        acc[cur.question_key] = cur.answer;
        return acc;
      }, {}),
    };

    console.log("[DEBUG] Profile Update Completed");

    logAuditEvent(userId, "PROFILE_EDIT", { email, first_name, last_name }, req);

    return res.status(200).json({
      message: "Profile and email updated successfully",
      user: userResult.rows[0],
      profile: profileWithPrompts,
      // prompts: savedPrompts, // Uncomment if you want to return saved prompts
    });
  } catch (error) {
    console.error("Error updating profile and email:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// 🟢 Get Profile
export const getProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const userQuery = `
      SELECT id, email
      FROM users
      WHERE id = $1
    `;
    const userResult = await pool.query(userQuery, [userId]);

    if (!userResult.rows.length) {
      return res.status(404).json({ message: "User not found" });
    }

    const profileQuery = `
      SELECT 
        id,
        first_name,
        last_name,
        phone,
        gender,
        marital_status,
        address,
        profession,
        skills,
        interests,
        hobbies,
        about,
        city,
        state,
        country,
        pincode,
        headline,
        dob,
        age,
        education,
        company,
        company_type,
        experience,
        position,
        professional_identity,
        interested_in,
        relationship_goal,
        children_preference,
        education_institution_name,
        languages_spoken,
        zodiac_sign,
        self_expression,
        freetime_style,
        health_activity_level,
        pets_preference,
        religious_belief,
        smoking,
        drinking,
        work_environment,
        interaction_style,
        work_rhythm,
        career_decision_style,
        work_demand_response,
        love_language_affection,
        preference_of_closeness,
        approach_to_physical_closeness,
        relationship_values,
        values_in_others,
        relationship_pace,
        height,
        life_rhythms,
        username,
        about_me,
        ways_i_spend_time,
        image_url,
        intent_tags,
        contextual_tags,
        confidence_score,
        sentiment_audit,
        spider_graph_data,
        is_submitted,
        ST_Y(location::geometry) as latitude,
        ST_X(location::geometry) as longitude,
        updated_at
      FROM profiles
      WHERE user_id = $1
    `;

    const profileResult = await pool.query(profileQuery, [userId]);

    const user = userResult.rows[0];
    const profile = profileResult.rows.length ? profileResult.rows[0] : {};

    // pull profile prompts (questions and answers)
    let prompts = {};

    if (profile && profile.id) {
      const promptsQuery = `
        SELECT question_key, answer
        FROM profile_prompts
        WHERE profile_id = $1
      `;

      const promptsResult = await pool.query(promptsQuery, [profile.id]);

      for (const row of promptsResult.rows) {
        prompts[row.question_key] = row.answer;
      }
    }

    const combinedData = {
      id: profile.id,
      user_id: user.id,
      email: user.email,
      first_name: profile.first_name || null,
      last_name: profile.last_name || null,
      profession: profile.profession || null,
      phone: profile.phone || null,
      gender: profile.gender || null,
      marital_status: profile.marital_status || null,
      address: profile.address || null,
      city: profile.city || null,
      state: profile.state || null,
      country: profile.country || null,
      pincode: profile.pincode || null,
      skills: profile.skills || null,
      interests: profile.interests || null,
      hobbies: profile.hobbies || null,
      about: profile.about || null,
      headline: profile.headline || null,
      dob: profile.dob || null,
      age: profile.age || null,
      education: profile.education || null,
      company: profile.company || null,
      company_type: profile.company_type || null,
      experience: profile.experience || null,
      position: profile.position || null,
      professional_identity: profile.professional_identity || null,
      interested_in: profile.interested_in || null,
      relationship_goal: profile.relationship_goal || null,
      children_preference: profile.children_preference || null,
      education_institution_name: profile.education_institution_name || null,
      languages_spoken: profile.languages_spoken || null,
      zodiac_sign: profile.zodiac_sign || null,
      self_expression: profile.self_expression || null,
      freetime_style: profile.freetime_style || null,
      health_activity_level: profile.health_activity_level || null,
      pets_preference: profile.pets_preference || null,
      religious_belief: profile.religious_belief || null,
      smoking: profile.smoking || null,
      drinking: profile.drinking || null,
      work_environment: profile.work_environment || null,
      interaction_style: profile.interaction_style || null,
      work_rhythm: profile.work_rhythm || null,
      career_decision_style: profile.career_decision_style || null,
      work_demand_response: profile.work_demand_response || null,
      love_language_affection: profile.love_language_affection || null,
      preference_of_closeness: profile.preference_of_closeness || null,
      approach_to_physical_closeness:
        profile.approach_to_physical_closeness || null,
      relationship_values: profile.relationship_values || null,
      values_in_others: profile.values_in_others || null,
      relationship_pace: profile.relationship_pace || null,
      height: profile.height || null,
      life_rhythms: profile.life_rhythms || null,
      ways_i_spend_time: profile.ways_i_spend_time || null,
      username: profile.username || null,
      about_me: profile.about_me || null,
      intent_tags: profile.intent_tags || null,
      contextual_tags: profile.contextual_tags || null,
      confidence_score: profile.confidence_score !== null && profile.confidence_score !== undefined ? profile.confidence_score : null,
      image_url: profile.image_url || null,
      is_submitted: profile.is_submitted || false,
      latitude: profile.latitude || null,
      longitude: profile.longitude || null,
      updated_at: profile.updated_at || null,
    };
    console.log("my profile data:", combinedData);
    res.status(200).json({
      message: "Profile fetched successfully",
      data: combinedData,
      prompts: prompts,
    });
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
// Helper function to save or update profile prompts
//   return results;
const saveOrUpdateProfilePrompts = async (profileId, prompts) => {
  if (!prompts || typeof prompts !== "object") return [];

  const query = `
    INSERT INTO profile_prompts (profile_id, question_key, answer)
    VALUES ($1, $2, $3)
    ON CONFLICT (profile_id, question_key)
    DO UPDATE SET 
      answer = EXCLUDED.answer,
      updated_at = NOW()
    RETURNING profile_id, question_key, answer;
  `;

  const results = [];

  for (const [question_key, answer] of Object.entries(prompts)) {
    const { rows } = await pool.query(query, [profileId, question_key, answer]);
    results.push(rows[0]);
  }

  return results;
};

// 🟢 Update Location (PostGIS)
export const updateLocation = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    const userId = req.user.id;

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ message: "Latitude and longitude are required" });
    }

    const lat = Number(latitude);
    const lon = Number(longitude);

    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return res.status(400).json({ message: "Invalid coordinates values" });
    }

    // Format POINT(longitude latitude) - ORDER MATTERS in PostGIS
    const pointWkt = `POINT(${lon} ${lat})`;

    const query = `
      UPDATE profiles
      SET 
        location = ST_GeographyFromText($1),
        latitude = $3,
        longitude = $4,
        updated_at = NOW()
      WHERE user_id = $2
      RETURNING *;
    `;

    const { rows } = await pool.query(query, [pointWkt, userId, lat, lon]);

    if (!rows.length) {
      return res.status(404).json({ message: "Profile not found" });
    }

    return res.status(200).json({
      message: "Location updated successfully",
      profile: rows[0]
    });
  } catch (error) {
    console.error("Error updating location:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// 🟢 Get Nearby Profiles (PostGIS RPC wrapper)
export const getNearbyProfiles = async (req, res) => {
  try {
    const { latitude, longitude, radiusInKm } = req.query;
    const userId = req.user.id;

    if (!latitude || !longitude) {
      return res.status(400).json({ message: "Latitude and longitude are required" });
    }

    const lat = Number(latitude);
    const lon = Number(longitude);
    const radius = Number(radiusInKm || 50) * 1000; // default 50km in meters

    if (isNaN(lat) || isNaN(lon) || isNaN(radius)) {
      return res.status(400).json({ message: "Invalid query parameters" });
    }

    const query = `
      SELECT * FROM get_nearby_profiles($1, $2, $3)
      WHERE user_id != $4;
    `;

    const { rows } = await pool.query(query, [lat, lon, radius, userId]);

    return res.status(200).json({
      message: "Nearby profiles fetched successfully",
      data: rows
    });
  } catch (error) {
    console.error("Error fetching nearby profiles:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

/* Example of prompts object:

"little_about_you": {
    "question-key" : {
         "small_habit": "I journal daily",
         "life_goal": "Build a peaceful life",
         "home_moment": "Sunday mornings with family"
    }
  }  */
