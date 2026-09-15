import { z } from "zod";

// ─── Enum Values (Source of Truth) ──────────────────────────────────────────

export const PROFILE_ENUMS = {
  gender: ["Male", "Female", "Non-Binary", "Other"],
  marital_status: ["Single", "Married", "Divorced", "Widowed", "Other", "Separated"],
  interested_in: ["Man", "Woman", "Non-Binary", "Everyone"],
  relationship_goal: ["Long-term", "Life Partner", "Dating with intent", "Friend", "Figuring it out"],
  children_preference: ["Want", "Don't want", "Have and want more", "Have and don't want more", "Open / Not Sure yet", "Open / Not sure yet"],
  pets_preference: ["Want", "Don't want", "Have and want more", "Have and don't want more", "Open / Not sure yet", "Open / Not Sure yet"],
  education: ["No Formal Education", "Currently Studying", "High School", "Vocational / Trade School", "Associate Degree", "Bachelors Degree", "Masters Degree", "Doctorate"],
  smoking: ["No", "Yes", "Socially"],
  drinking: ["No", "Yes", "Socially"],
  professional_identity: [
    "Corporate Professional", "Entrepreneur", "Startup Founder", "Freelancer",
    "Consultant Trader", "Investor", "Family Business Owner", "Small Business Owner",
    "Creative Professional", "Healthcare Professional", "Public Service", "Government",
    "Student", "Other",
  ],
  company_type: ["MNC", "Startup", "SME", "Government", "NGO", "Other"],
  work_environment: ["Remote", "Hybrid", "Office/Location based", "On-the-go", "Other"],
  work_rhythm: ["Structured routine", "Balanced with busy phases", "High intensity", "Unpredictable", "Project-based", "Travel-heavy"],
  career_decision_style: ["Security-focused", "Balanced", "Opportunity-driven", "Risk-positive"],
  work_demand_response: ["Adjusting plans quickly", "Keeping structure", "Taking space to rebalance", "Communicating clearly and finding a middle ground"],
  freetime_style: ["Mostly social", "With Partner", "Balanced mix", "Low-key and restful"],
  health_activity_level: ["Active", "Semi-active", "Light", "Minimal"],
  self_expression: ["Clear and direct", "Reflective and calm", "Expressive once I trust", "Reserved until I feel safe"],
  interaction_style: ["Light and engaging", "Deep and thought-provoking", "Reserved unless invited", "Other"],
  preference_of_closeness: ["More time together", "A mix of space and closeness", "Regular personal time", "Not yet sure"],
  love_language_affection: ["Physical Touch", "Words of Affirmation", "Quality Time", "Acts of Service", "Thoughtful Gifts"],
  approach_to_physical_closeness: ["Gradual build-up", "Connect early if aligned", "Emotional-first", "Emotional + physical balanced", "Prefer more time"],
  relationship_values: ["Growth", "Stability", "Emotional openness", "Shared rhythm", "Practical harmony"],
  values_in_others: ["Self-awareness", "Emotional intelligence", "Ambition", "Kindness", "Humour"],
  relationship_pace: ["Naturally", "Quickly", "Slowly", "With clear definition"],
  religious_belief: ["Hindu", "Muslim", "Christian", "Sikh", "Buddhist", "Jain", "Jewish", "Spiritual", "Atheist", "Agnostic", "Other", "Prefer not to say"],
  zodiac_sign: ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"],
};

// Helper: create an optional enum field that allows null/empty
const optionalEnum = (enumName) =>
  z.enum(PROFILE_ENUMS[enumName], {
    errorMap: () => ({ message: `Invalid selection for ${enumName}.` }),
  }).nullish().or(z.literal(""));

// Helper: optional string with max length
const optStr = (name, max) =>
  z.string().trim().max(max, `${name} cannot exceed ${max} characters.`).nullish().or(z.literal(""));

// ─── Profile Update Schema ──────────────────────────────────────────────────

export const profileUpdateSchema = z.object({
  // Required fields
  email: z
    .string({ required_error: "Email is required." })
    .trim()
    .max(100, "Email address cannot exceed 100 characters.")
    .email("Please enter a valid email address."),
  first_name: z
    .string({ required_error: "First name is required." })
    .trim()
    .min(2, "First name must be between 2 and 50 characters.")
    .max(50, "First name must be between 2 and 50 characters.")
    .regex(/^[a-zA-Z\s\-]+$/, "First name can only contain letters, spaces, and hyphens."),
  last_name: z
    .string({ required_error: "Last name is required." })
    .trim()
    .min(2, "Last name must be between 2 and 50 characters.")
    .max(50, "Last name must be between 2 and 50 characters.")
    .regex(/^[a-zA-Z\s\-]+$/, "Last name can only contain letters, spaces, and hyphens."),

  // Optional text fields
  headline: optStr("Headline", 200),
  phone: z
    .string()
    .trim()
    .regex(/^[+0-9\s\-()]*$/, "Phone number can only contain digits, spaces, hyphens, parentheses, and +.")
    .refine(
      (val) => {
        if (!val) return true;
        const digits = val.replace(/[^0-9]/g, "").length;
        return digits >= 7 && digits <= 15;
      },
      { message: "Phone number should be between 7 and 15 digits long." }
    )
    .nullish()
    .or(z.literal("")),
  company: optStr("Company", 100),
  position: optStr("Position", 100),
  profession: optStr("Profession", 100),
  city: optStr("City", 100),
  state: optStr("State", 100),
  country: optStr("Country", 100),
  pincode: optStr("Pincode", 20),
  address: optStr("Address", 500),
  education_institution_name: optStr("Education Institution", 150),
  about: optStr("About", 1000),
  about_me: optStr("About Me", 1000),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^(?!\.)(?!.*\.\.)(?!.*\.$)[a-z0-9._]{3,30}$/,
      "Username must be 3–30 characters, lowercase, and can contain letters, numbers, dots (.), or underscores (_)."
    )
    .nullish()
    .or(z.literal("")),

  // Numeric fields
  age: z.coerce
    .number()
    .int("Age must be a whole number.")
    .min(18, "You must be at least 18 years old.")
    .max(120, "Age must be a valid number between 18 and 120.")
    .nullish(),
  experience: z.coerce
    .number()
    .int("Experience must be a whole number.")
    .min(0, "Experience must be a number between 0 and 80.")
    .max(80, "Experience must be a number between 0 and 80.")
    .nullish(),
  height_ft: z.coerce
    .number()
    .int()
    .min(3, "Feet must be between 3 and 8.")
    .max(8, "Feet must be between 3 and 8.")
    .nullish(),
  height_in: z.coerce
    .number()
    .int()
    .min(0, "Inches must be between 0 and 11.")
    .max(11, "Inches must be between 0 and 11.")
    .nullish(),
  latitude: z.coerce
    .number()
    .min(-90, "Latitude must be between -90 and 90.")
    .max(90, "Latitude must be between -90 and 90.")
    .nullish(),
  longitude: z.coerce
    .number()
    .min(-180, "Longitude must be between -180 and 180.")
    .max(180, "Longitude must be between -180 and 180.")
    .nullish(),

  // Date field
  dob: z
    .string()
    .refine(
      (val) => {
        if (!val) return true;
        const d = new Date(val);
        return !isNaN(d.getTime()) && d < new Date();
      },
      { message: "Date of Birth must be a valid date in the past." }
    )
    .refine(
      (val) => {
        if (!val) return true;
        const d = new Date(val);
        const today = new Date();
        let age = today.getFullYear() - d.getFullYear();
        const m = today.getMonth() - d.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
        return age >= 18;
      },
      { message: "You must be at least 18 years old." }
    )
    .nullish()
    .or(z.literal("")),

  // Enum / dropdown fields (all optional)
  gender: optionalEnum("gender"),
  marital_status: optionalEnum("marital_status"),
  interested_in: optionalEnum("interested_in"),
  relationship_goal: optionalEnum("relationship_goal"),
  children_preference: optionalEnum("children_preference"),
  pets_preference: optionalEnum("pets_preference"),
  education: optionalEnum("education"),
  smoking: optionalEnum("smoking"),
  drinking: optionalEnum("drinking"),
  professional_identity: optionalEnum("professional_identity"),
  company_type: optionalEnum("company_type"),
  work_environment: optionalEnum("work_environment"),
  work_rhythm: optionalEnum("work_rhythm"),
  career_decision_style: optionalEnum("career_decision_style"),
  work_demand_response: optionalEnum("work_demand_response"),
  freetime_style: optionalEnum("freetime_style"),
  health_activity_level: optionalEnum("health_activity_level"),
  self_expression: optionalEnum("self_expression"),
  interaction_style: optionalEnum("interaction_style"),
  preference_of_closeness: optionalEnum("preference_of_closeness"),
  love_language_affection: optionalEnum("love_language_affection"),
  approach_to_physical_closeness: optionalEnum("approach_to_physical_closeness"),
  relationship_values: optionalEnum("relationship_values"),
  values_in_others: optionalEnum("values_in_others"),
  relationship_pace: optionalEnum("relationship_pace"),
  religious_belief: optionalEnum("religious_belief"),
  zodiac_sign: optionalEnum("zodiac_sign"),

  // JSON/array fields — accept flexibly, validate shape at a high level
  skills: z.any().nullish(),
  interests: z.any().nullish(),
  hobbies: z.any().nullish(),
  languages_spoken: z.array(z.string()).or(z.any()).nullish(),
  life_rhythms: z.any().nullish(),
  ways_i_spend_time: z.any().nullish(),
  prompts: z.any().nullish(),
}).passthrough(); // Allow unknown fields through so we don't break existing FE payloads

// ─── Location Update Schema ────────────────────────────────────────────────

export const locationUpdateSchema = z.object({
  latitude: z.coerce
    .number({ required_error: "Latitude is required." })
    .min(-90, "Latitude must be between -90 and 90.")
    .max(90, "Latitude must be between -90 and 90."),
  longitude: z.coerce
    .number({ required_error: "Longitude is required." })
    .min(-180, "Longitude must be between -180 and 180.")
    .max(180, "Longitude must be between -180 and 180."),
});
