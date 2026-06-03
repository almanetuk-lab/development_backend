import { updateProfile } from './controller/profileController.js';
import { pool } from './config/db.js';

async function runTest() {
  const req = {
    user: { id: 264 },
    body: {
      email: 'imrank@gmail.com',
      first_name: 'imran',
      last_name: 'dev',
      username: 'devimran78',
      dob: '2026-05-14',
      age: 24,
      about_me: 'I work long hours in tech and enjoy calm weekends, deep conversations, and meaningful relationships.',
      gender: 'Male',
      marital_status: 'Single',
      profession: 'Graphics Designer',
      phone: '1234567890',
      address: 'Test Address',
      skills: 'Photoshop, Illustrator',
      interests: 'Design, Art',
      city: 'Delhi',
      state: 'Delhi',
      country: 'India',
      pincode: '110001',
      headline: 'Graphics Designer Pro',
      company: 'Self',
      company_type: 'Freelancer',
      experience: 3,
      position: 'Lead',
      hobbies: 'Sketching',
      professional_identity: 'Freelancer',
      interested_in: 'Woman',
      relationship_goal: 'Life Partner',
      children_preference: 'Want',
      education_institution_name: 'NID',
      languages_spoken: ['English', 'Hindi'],
      zodiac_sign: 'Taurus',
      self_expression: 'Clear and direct',
      freetime_style: 'Balanced mix',
      health_activity_level: 'Active',
      pets_preference: 'Want',
      religious_belief: 'Spiritual',
      smoking: 'No',
      drinking: 'No',
      work_environment: null,
      interaction_style: 'Light and engaging',
      work_rhythm: null,
      career_decision_style: 'Balanced',
      work_demand_response: null,
      love_language_affection: 'Words of Affirmation',
      preference_of_closeness: null,
      approach_to_physical_closeness: null,
      relationship_values: null,
      values_in_others: 'Kindness',
      relationship_pace: 'Naturally',
      height_ft: 5,
      height_in: 8,
      life_rhythms: {},
      ways_i_spend_time: {}
    },
    file: null
  };

  const res = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.data = data;
      console.log('STATUS:', this.statusCode || 200);
      console.log('RESPONSE:', data);
      return this;
    }
  };

  try {
    console.log('🚀 Starting end-to-end profile update pipeline test...');
    await updateProfile(req, res);
    console.log('🏁 End of test.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Pipeline Test Error:', error);
    process.exit(1);
  }
}

runTest();
