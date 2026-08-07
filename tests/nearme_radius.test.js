/**
 * nearme_radius.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit + Integration tests for the "Near Me" radius search feature.
 *
 * Run:  node --experimental-vm-modules backend/tests/nearme_radius.test.js
 * OR:   cd backend && node tests/nearme_radius.test.js
 *
 * No external test runner needed — uses a minimal hand-rolled test harness.
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

// ─── Minimal test harness ─────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ PASS  ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL  ${label}`);
    failed++;
  }
}

function assertEqual(a, b, label) {
  assert(a === b, `${label}  [expected: ${b}, got: ${a}]`);
}

function assertClose(a, b, tol = 0.5, label = "") {
  assert(Math.abs(a - b) <= tol, `${label}  [expected ~${b}, got ${a}]`);
}

function section(title) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`📦 ${title}`);
  console.log("─".repeat(60));
}

// ─── Haversine helper (mirrors SQL formula) ───────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// ─── Frontend radius param builder (mirrors SearchSection.jsx logic) ──────────
const DEFAULT_RADIUS = 10;

function buildNearMeParams(filters) {
  const radVal =
    typeof filters.radius === "number" && !isNaN(filters.radius) && filters.radius >= 1
      ? filters.radius
      : DEFAULT_RADIUS;

  const searchParams = {
    search_mode: "nearme",
    radius: radVal,
  };

  if (filters.lat !== "" && filters.lat !== null && !isNaN(Number(filters.lat))) {
    searchParams.lat = filters.lat;
  }
  if (filters.lon !== "" && filters.lon !== null && !isNaN(Number(filters.lon))) {
    searchParams.lon = filters.lon;
  }
  if (filters.city && typeof filters.city === "string" && filters.city.trim() !== "") {
    searchParams.city = filters.city.trim();
  }

  return searchParams;
}

// ─── Backend radius parser (mirrors searchController.js logic) ────────────────
function parseBackendRadius(queryRadius) {
  return queryRadius !== undefined && queryRadius !== null && queryRadius !== ""
    ? Number(queryRadius)
    : 50; // backend default when missing
}

// ─── Tests ────────────────────────────────────────────────────────────────────

section("1. Haversine Distance Formula");
{
  // Mumbai → Pune straight-line (air) distance ≈ 120 km.
  // NOTE: Road distance is ~149 km, but Haversine gives great-circle (straight-line) distance.
  assertClose(haversineKm(19.076, 72.877, 18.52, 73.856), 120, 3,
    "Mumbai → Pune straight-line is ~120 km");

  // Same point → 0 km
  assertClose(haversineKm(28.6139, 77.2090, 28.6139, 77.2090), 0, 0.01,
    "Same coordinates → 0 km");

  // Delhi → Gurgaon straight-line (air) distance ≈ 25 km.
  // NOTE: Road distance is ~30 km, but Haversine gives great-circle (straight-line) distance.
  assertClose(haversineKm(28.6139, 77.2090, 28.4595, 77.0266), 25, 2,
    "Delhi → Gurgaon straight-line is ~25 km");

  // Antipodal points ≈ 20015 km
  assertClose(haversineKm(0, 0, 0, 180), 20015, 10,
    "Antipodal points ~20015 km");
}

section("2. Radius Filtering Logic");
{
  const userLat = 19.076, userLon = 72.877; // Mumbai
  const radius = 50; // km

  const candidates = [
    { name: "Andheri (Mumbai)",       lat: 19.1136, lon: 72.8697 }, // ~4 km   → IN
    { name: "Navi Mumbai",            lat: 19.033,  lon: 73.029  }, // ~17 km  → IN
    { name: "Thane",                  lat: 19.197,  lon: 72.971  }, // ~16 km  → IN
    { name: "Pune",                   lat: 18.52,   lon: 73.856  }, // ~149 km → OUT
    { name: "Nashik",                 lat: 19.997,  lon: 73.789  }, // ~112 km → OUT
  ];

  const expected = {
    "Andheri (Mumbai)": true,
    "Navi Mumbai": true,
    "Thane": true,
    "Pune": false,
    "Nashik": false,
  };

  candidates.forEach(({ name, lat, lon }) => {
    const dist = haversineKm(userLat, userLon, lat, lon);
    const inRange = dist <= radius;
    assert(inRange === expected[name],
      `${name} (${dist.toFixed(1)} km) should be ${expected[name] ? "IN" : "OUT"} radius ${radius} km`);
  });
}

section("3. Frontend Radius Param Builder");
{
  // Default when radius is numeric 10
  const p1 = buildNearMeParams({ radius: 10, distance: 10, lat: "", lon: "", city: "" });
  assertEqual(p1.radius, 10, "Default radius = 10");
  assert(!("lat" in p1), "Empty lat not sent to API");
  assert(!("lon" in p1), "Empty lon not sent to API");
  assert(!("city" in p1), "Empty city not sent to API");

  // GPS + custom radius
  const p2 = buildNearMeParams({ radius: 25, distance: 25, lat: 19.076, lon: 72.877, city: "" });
  assertEqual(p2.radius, 25, "Custom radius 25 is sent correctly");
  assertEqual(p2.lat, 19.076, "GPS lat is sent");
  assertEqual(p2.lon, 72.877, "GPS lon is sent");

  // City filter
  const p3 = buildNearMeParams({ radius: 15, distance: 15, lat: "", lon: "", city: "  Mumbai  " });
  assertEqual(p3.city, "Mumbai", "City is trimmed before sending");
  assertEqual(p3.radius, 15, "Radius included with city search");

  // If radius is somehow 0 or negative, fallback to DEFAULT_RADIUS
  const p4 = buildNearMeParams({ radius: 0, distance: 0, lat: "", lon: "", city: "" });
  assertEqual(p4.radius, DEFAULT_RADIUS, "radius=0 falls back to DEFAULT_RADIUS");

  const p5 = buildNearMeParams({ radius: -5, distance: -5, lat: "", lon: "", city: "" });
  assertEqual(p5.radius, DEFAULT_RADIUS, "radius=-5 falls back to DEFAULT_RADIUS");

  // NaN guard
  const p6 = buildNearMeParams({ radius: NaN, distance: NaN, lat: "", lon: "", city: "" });
  assertEqual(p6.radius, DEFAULT_RADIUS, "radius=NaN falls back to DEFAULT_RADIUS");

  // GPS with city (both should be sent)
  const p7 = buildNearMeParams({ radius: 30, distance: 30, lat: 28.6139, lon: 77.2090, city: "Delhi" });
  assert("lat" in p7 && "lon" in p7 && "city" in p7,
    "GPS+city both forwarded to API");
  assertEqual(p7.radius, 30, "Radius = 30 with GPS+city");
}

section("4. Backend Radius Parser");
{
  // Query params arrive as strings from HTTP
  assertEqual(parseBackendRadius("25"), 25, "String '25' parsed as number 25");
  assertEqual(parseBackendRadius("0"), 0,   "String '0' parsed as 0");
  assertEqual(parseBackendRadius(""),  50,  "Empty string → backend default 50");
  assertEqual(parseBackendRadius(undefined), 50, "undefined → backend default 50");
  assertEqual(parseBackendRadius(null), 50, "null → backend default 50");
  assertEqual(parseBackendRadius("10.5"), 10.5, "Decimal '10.5' parsed correctly");
}

section("5. Distance–Radius State Sync (handleInputChange logic)");
{
  // Simulates the updated handleInputChange function
  function handleInputChange(filters, field, value) {
    const DEFAULT_RADIUS = 10;
    if (field === "distance" || field === "radius") {
      const normalized = value === "" || value === null ? DEFAULT_RADIUS : Math.max(1, Number(value));
      return { ...filters, distance: normalized, radius: normalized };
    }
    return { ...filters, [field]: value };
  }

  let f = { radius: 10, distance: 10, city: "" };

  // Slider moves to 30
  f = handleInputChange(f, "distance", "30");
  assertEqual(f.radius, 30,   "Moving slider → radius synced to 30");
  assertEqual(f.distance, 30, "Moving slider → distance synced to 30");

  // Number input changes to 50
  f = handleInputChange(f, "radius", "50");
  assertEqual(f.radius, 50,   "Number input → radius synced to 50");
  assertEqual(f.distance, 50, "Number input → distance synced to 50");

  // Clearing input resets to DEFAULT_RADIUS (not empty string)
  f = handleInputChange(f, "radius", "");
  assertEqual(f.radius, DEFAULT_RADIUS,   "Clear radius → resets to DEFAULT_RADIUS");
  assertEqual(f.distance, DEFAULT_RADIUS, "Clear radius → distance also resets");

  // Negative values clamped to 1
  f = handleInputChange(f, "radius", "-5");
  assertEqual(f.radius, 1,   "Negative radius clamped to 1");
  assertEqual(f.distance, 1, "Negative distance clamped to 1");
}

section("6. Coordinate Validation");
{
  function isValidCoord(lat, lon) {
    return (
      lat !== "" && lat !== null && !isNaN(Number(lat)) &&
      lon !== "" && lon !== null && !isNaN(Number(lon)) &&
      Number(lat) >= -90 && Number(lat) <= 90 &&
      Number(lon) >= -180 && Number(lon) <= 180
    );
  }

  assert(isValidCoord(19.076, 72.877),     "Valid Mumbai coords");
  assert(isValidCoord("19.076", "72.877"), "Valid coords as strings");
  assert(!isValidCoord("", ""),            "Empty coords are invalid");
  assert(!isValidCoord(null, null),        "Null coords are invalid");
  assert(!isValidCoord(91, 0),             "Lat > 90 is invalid");
  assert(!isValidCoord(0, 181),            "Lon > 180 is invalid");
  assert(!isValidCoord("abc", 0),          "Non-numeric lat is invalid");
}

// ─── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(60)}`);
console.log(`📊 Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("🎉 All tests passed!");
} else {
  console.error(`⚠️  ${failed} test(s) failed — see above for details.`);
  process.exitCode = 1;
}
