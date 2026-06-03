import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { getSuggestions } from '../controller/matchController.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function testSuggestions() {
  const req = {
    user: { id: 265 }
  };

  const res = {
    status: function(code) {
      this.statusCode = code;
      return this;
    },
    json: function(data) {
      console.log(`Response Status: ${this.statusCode}`);
      if (this.statusCode >= 400) {
          console.log(`Error Response:`, data);
      } else {
          console.log(`Success! Returned ${data?.suggestions?.length || data?.length} suggestions.`);
      }
    }
  };

  try {
    await getSuggestions(req, res);
  } catch (err) {
    console.error("Unhandled Error in getSuggestions:", err);
  }
}

testSuggestions();
