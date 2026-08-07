import { pool } from "./config/db.js";

async function runTests() {
  console.log("=== DB Profiles and GPS coordinates ===");
  const profilesRes = await pool.query(
    "SELECT user_id, city, pincode, latitude, longitude FROM profiles ORDER BY user_id"
  );
  console.table(profilesRes.rows);

  // Import the controller function or test the exact query logic
  const computedLat = `pr.latitude`;
  const computedLon = `pr.longitude`;

  async function mockSearch({ searchLat, searchLon, searchRadiusKm, city }) {
    console.log(`\n--- Test searchLat=${searchLat}, searchLon=${searchLon}, radius=${searchRadiusKm}km, city=${city} ---`);
    if (searchLat === null || searchLon === null || isNaN(searchLat) || isNaN(searchLon)) {
      console.log("Result: [] (Requires coordinates)");
      return;
    }

    const params = [searchLat, searchLon, searchRadiusKm];
    let idx = 4; // index starts at 4 since lat/lon/rad are 1, 2, 3

    const distKmExpr = `6371.0 * acos(LEAST(1.0, GREATEST(-1.0,
      cos(radians($1)) * cos(radians(${computedLat})) *
      cos(radians(${computedLon}) - radians($2)) +
      sin(radians($1)) * sin(radians(${computedLat}))
    )))`;

    let queryStr = `
      SELECT pr.user_id, pr.city, pr.pincode,
             ${computedLat}             AS latitude,
             ${computedLon}             AS longitude,
             (${distKmExpr} * 1000.0)   AS distance_meters
      FROM profiles pr
      WHERE 1=1
    `;

    if (city && city.trim()) {
      params.push(`%${city.trim()}%`);
      queryStr += `
        AND ${computedLat} IS NOT NULL 
        AND ${computedLon} IS NOT NULL
        AND ${distKmExpr} <= $3
        AND LOWER(pr.city) LIKE LOWER($4)
      `;
    } else {
      queryStr += `
        AND ${computedLat} IS NOT NULL
        AND ${computedLon} IS NOT NULL
        AND ${distKmExpr} <= $3
      `;
    }

    queryStr += ` ORDER BY pr.user_id`;

    try {
      const { rows } = await pool.query(queryStr, params);
      console.log("Matches found:", rows.length);
      console.table(rows.map(r => ({
        ...r,
        distance_km: (r.distance_meters / 1000).toFixed(2)
      })));
    } catch (err) {
      console.error("Query Error:", err);
    }
  }

  // 1. Search from Indore with 60km radius
  await mockSearch({ searchLat: 22.7196, searchLon: 75.8577, searchRadiusKm: 60 });

  // 2. Search from Indore with 10km radius
  await mockSearch({ searchLat: 22.7196, searchLon: 75.8577, searchRadiusKm: 10 });

  // 3. Search from Indore with 200km radius and city="Bhopal"
  await mockSearch({ searchLat: 22.7196, searchLon: 75.8577, searchRadiusKm: 200, city: "Bhopal" });

  // 4. Search with no coordinates
  await mockSearch({ searchLat: null, searchLon: null, searchRadiusKm: 50 });

  pool.end();
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  pool.end();
});
