// Builds the four climate presets in data/climate/ from typical-year weather files.
//
// Source: OneBuilding TMYx 2009–2023 EPW files (typical meteorological year assembled
// from NOAA ISD / ERA5 hourly observations). Dry-bulb comes straight from the file.
// Wet-bulb is not stored in EPW, so it is solved from dry-bulb, dew point and station
// pressure with the ASHRAE Fundamentals psychrometric equations.
//
// Quality control: a few TMYx hours carry dew points no station has recorded (Phoenix shows
// 32 °C dew points on 10 July). Hourly wet-bulb is therefore capped at the station's 50-year
// return-period extreme wet-bulb from the ASHRAE design conditions in the same file.
//
// Run from twin/: node packages/catalog/scripts/synthesize-climate.mjs
import { writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ONEBUILDING = 'https://climate.onebuilding.org';
const AS_OF = '2026-10-18';
const HOURS_PER_YEAR = 8760;

export const STATIONS = [
  {
    id: 'climate.dallas',
    city: 'Dallas',
    name: 'Dallas–Fort Worth, Texas',
    url: `${ONEBUILDING}/WMO_Region_4_North_and_Central_America/USA_United_States_of_America/TX_Texas/USA_TX_Dallas-Fort.Worth.Intl.AP.722590_TMYx.2009-2023.zip`,
  },
  {
    id: 'climate.phoenix',
    city: 'Phoenix',
    name: 'Phoenix, Arizona',
    url: `${ONEBUILDING}/WMO_Region_4_North_and_Central_America/USA_United_States_of_America/AZ_Arizona/USA_AZ_Phoenix-Sky.Harbor.Intl.AP.722780_TMYx.2009-2023.zip`,
  },
  {
    id: 'climate.frankfurt',
    city: 'Frankfurt',
    name: 'Frankfurt am Main, Germany',
    url: `${ONEBUILDING}/WMO_Region_6_Europe/DEU_Germany/HE_Hessen/DEU_HE_Frankfurt.AP.106370_TMYx.2009-2023.zip`,
  },
  {
    id: 'climate.stockholm',
    city: 'Stockholm',
    name: 'Stockholm Arlanda, Sweden',
    url: `${ONEBUILDING}/WMO_Region_6_Europe/SWE_Sweden/ST_Stockholm/SWE_ST_Stockholm.Arlanda.AP.024600_TMYx.2009-2023.zip`,
  },
];

// Saturation vapour pressure in Pa (Alduchov and Eskridge 1996 Magnus fits, over water and over ice).
function saturationPressurePa(tC) {
  return tC >= 0 ? 610.94 * Math.exp((17.625 * tC) / (tC + 243.04)) : 611.21 * Math.exp((22.587 * tC) / (tC + 273.86));
}

// Humidity ratio in kg/kg for a vapour pressure at a total pressure (ASHRAE Fundamentals ch. 1, eq. 20).
function humidityRatio(vapourPa, pressurePa) {
  return (0.621945 * vapourPa) / (pressurePa - vapourPa);
}

// Humidity ratio implied by a wet-bulb guess (ASHRAE Fundamentals ch. 1, eqs. 33 and 35).
function humidityRatioAtWetBulb(dryC, wetC, pressurePa) {
  const ws = humidityRatio(saturationPressurePa(wetC), pressurePa);
  return wetC >= 0
    ? ((2501 - 2.326 * wetC) * ws - 1.006 * (dryC - wetC)) / (2501 + 1.86 * dryC - 4.186 * wetC)
    : ((2830 - 0.24 * wetC) * ws - 1.006 * (dryC - wetC)) / (2830 + 1.86 * dryC - 2.1 * wetC);
}

// Thermodynamic wet-bulb in °C, solved by bisection between the dew point and the dry-bulb.
export function wetBulbC(dryBulbC, dewPointC, pressurePa) {
  const dew = Math.min(dewPointC, dryBulbC);
  const target = humidityRatio(saturationPressurePa(dew), pressurePa);
  let low = dew - 10;
  let high = dryBulbC;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (humidityRatioAtWetBulb(dryBulbC, mid, pressurePa) > target) high = mid;
    else low = mid;
  }
  return Math.min((low + high) / 2, dryBulbC);
}

// EPW layout: 8 header lines, then one row per hour. Columns 6, 7 and 9 are dry-bulb (°C),
// dew point (°C) and station pressure (Pa). Missing values are 99.9 / 999999.
export function parseEpw(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  const location = lines[0].split(',');
  const design = lines[1].split(',');
  const cooling = design.indexOf('Cooling');
  const extremes = design.indexOf('Extremes');
  if (location[0] !== 'LOCATION' || cooling < 0 || extremes < 0) throw new Error('not an EPW file with design conditions');
  // Extremes block: 3 wind speeds, 12 dry-bulb values, then 12 wet-bulb values ending with the 50-year maximum.
  const extremeWetBulbC = Number(design[extremes + 27]);
  if (!Number.isFinite(extremeWetBulbC)) throw new Error('design conditions lack the 50-year extreme wet-bulb');
  const hours = lines.slice(8).map((line, i) => {
    const f = line.split(',');
    const hour = { month: Number(f[1]), dryBulbC: Number(f[6]), dewPointC: Number(f[7]), pressurePa: Number(f[9]) };
    if (!(hour.dryBulbC < 99) || !(hour.dewPointC < 99) || !(hour.pressurePa < 999999)) {
      throw new Error(`missing value in EPW data row ${i + 1}`);
    }
    return hour;
  });
  if (hours.length !== HOURS_PER_YEAR) throw new Error(`expected ${HOURS_PER_YEAR} hours, got ${hours.length}`);
  return {
    lat: Number(location[6]),
    lon: Number(location[7]),
    // Cooling block: hottest month, daily range, then the 0.4 % annual design dry-bulb.
    designDryBulbC: Number(design[cooling + 3]),
    extremeWetBulbC,
    designSource: design[2],
    hours,
  };
}

const round1 = (x) => Math.round(x * 10) / 10;

export function climateEntry(station, epw) {
  // Rounding is monotonic, so a rounded wet-bulb never exceeds its rounded dry-bulb.
  const dry = epw.hours.map((h) => round1(h.dryBulbC));
  const solved = epw.hours.map((h) => wetBulbC(h.dryBulbC, h.dewPointC, h.pressurePa));
  const wet = solved.map((wb) => round1(Math.min(wb, epw.extremeWetBulbC)));
  const capped = solved.filter((wb) => wb > epw.extremeWetBulbC).length;
  return {
    id: station.id,
    kind: 'climate',
    name: station.name,
    asOf: AS_OF,
    sources: [{ id: 'onebuilding-tmyx', url: station.url, title: `OneBuilding TMYx 2009–2023 typical year, ${station.name}` }],
    summary: `Typical-year hourly dry-bulb and wet-bulb for ${station.name} (TMYx 2009–2023 from NOAA ISD and ERA5). Wet-bulb is solved from dry-bulb, dew point and station pressure with the ASHRAE psychrometric equations, capped at the 50-year extreme wet-bulb of ${epw.extremeWetBulbC} °C (${capped} h capped).`,
    city: station.city,
    lat: epw.lat,
    lon: epw.lon,
    designDryBulbC: {
      value: epw.designDryBulbC,
      unit: '°C',
      basis: 'textbook',
      source: station.url,
      note: `0.4 % annual cooling design dry-bulb from the EPW design-conditions header (${epw.designSource}).`,
    },
    dryBulbC: dry,
    wetBulbC: wet,
  };
}

// Pretty-prints the entry with one day (24 values) per line in the hourly arrays.
function formatEntry(entry) {
  const series = { dryBulbC: entry.dryBulbC, wetBulbC: entry.wetBulbC };
  const text = JSON.stringify({ ...entry, dryBulbC: '@dryBulbC', wetBulbC: '@wetBulbC' }, null, 2);
  return (
    text.replace(/"@(dryBulbC|wetBulbC)"/g, (_, key) => {
      const values = series[key];
      const days = [];
      for (let i = 0; i < values.length; i += 24) days.push(`    ${values.slice(i, i + 24).join(', ')}`);
      return `[\n${days.join(',\n')}\n  ]`;
    }) + '\n'
  );
}

// Reads the .epw member of a zip archive using the central directory.
function extractEpw(zip) {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('zip end-of-central-directory not found');
  const entries = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries; n++) {
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLength = zip.readUInt16LE(p + 28);
    const extraLength = zip.readUInt16LE(p + 30);
    const commentLength = zip.readUInt16LE(p + 32);
    const offset = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLength);
    if (name.endsWith('.epw')) {
      const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
      const data = zip.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(data) : data).toString('latin1');
    }
    p += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error('no .epw file in archive');
}

async function main() {
  for (const station of STATIONS) {
    const response = await fetch(station.url);
    if (!response.ok) throw new Error(`${station.url}: HTTP ${response.status}`);
    const epw = parseEpw(extractEpw(Buffer.from(await response.arrayBuffer())));
    const out = new URL(`../data/climate/${station.id}.json`, import.meta.url);
    writeFileSync(out, formatEntry(climateEntry(station, epw)));
    console.log(`${station.id}: ${epw.hours.length} h, design dry-bulb ${epw.designDryBulbC} °C`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
