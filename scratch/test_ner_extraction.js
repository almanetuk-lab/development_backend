import { extractProfessionalEntities } from "../services/entityRecognitionService.js";

const runTests = async () => {
  console.log("=== RUNNING NER EXTRACTION TESTS ===\n");

  const testCases = [
    {
      name: "Startup Executive",
      profile: {
        profession: "VP of Sales",
        company_type: "Tech Startup",
        work_environment: "Remote",
        about_me: "I scale startups from 0 to 1. Fast-paced, high pressure, always on the go.",
      }
    },
    {
      name: "Engineering IC",
      profile: {
        profession: "Software Engineer II",
        company_type: "Enterprise Software",
        work_environment: "Hybrid",
        about_me: "I write backend code for scalable systems. Pretty chill WLB.",
      }
    },
    {
      name: "Medical Professional",
      profile: {
        profession: "ER Nurse",
        company_type: "Hospital",
        work_environment: "On-Site",
        about_me: "12 hour shifts, high stress, but very rewarding. I love saving lives.",
      }
    }
  ];

  for (const tc of testCases) {
    console.log(`\n🔹 Testing Case: ${tc.name}`);
    console.log(`Input Profession: ${tc.profile.profession}`);
    const res = await extractProfessionalEntities(tc.profile);
    console.log(`Output:\n`, res);
  }
};

runTests();
