import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface ClimateFile {
  id: string;
  dryBulbC: number[];
  wetBulbC: number[];
}

interface EpwHour {
  month: number;
  dryBulbC: number;
  dewPointC: number;
  pressurePa: number;
}

interface Station {
  id: string;
  city: string;
  name: string;
  url: string;
}

interface ClimateScript {
  STATIONS: Station[];
  parseEpw: (text: string) => { lat: number; lon: number; designDryBulbC: number; extremeWetBulbC: number; hours: EpwHour[] };
  wetBulbC: (dryBulbC: number, dewPointC: number, pressurePa: number) => number;
  climateEntry: (station: Station, epw: ReturnType<ClimateScript['parseEpw']>) => ClimateFile;
}

const CLIMATE_IDS = ['climate.dallas', 'climate.phoenix', 'climate.frankfurt', 'climate.stockholm'];
const HOURS_PER_YEAR = 8760;
const JULY_HOURS = { first: 4344, count: 744 }; // hours before July 1 in a non-leap year: 181 days × 24

// NOAA NCEI 1991–2020 normals, Dallas-Fort Worth Intl (USW00003927): July mean 86.7 °F.
const DALLAS_JULY_NORMAL_C = ((86.7 - 32) * 5) / 9;

function loadClimate(id: string): ClimateFile {
  const url = new URL(`../data/climate/${id}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as ClimateFile;
}

async function loadScript(): Promise<ClimateScript> {
  const href = new URL('../scripts/synthesize-climate.mjs', import.meta.url).href;
  const script: ClimateScript = await import(href);
  return script;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function syntheticEpw(): string {
  const header = [
    'LOCATION,Test.Station,XX,XXX,SRC-TEST,000000,30.00000,-90.00000,-6.0,10.0',
    `DESIGN CONDITIONS,1,Test,Heating,1,-4.6,Cooling,8,10.6,35.2,23.5,Extremes,${Array(26).fill('0').join(',')},24.0`,
    'TYPICAL/EXTREME PERIODS,0',
    'GROUND TEMPERATURES,0',
    'HOLIDAYS/DAYLIGHT SAVINGS,No,0,0,0',
    'COMMENTS 1,test',
    'COMMENTS 2,test',
    'DATA PERIODS,1,1,Data,Sunday,1/ 1,12/31',
  ];
  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const rows: string[] = [];
  let hour = 0;
  daysInMonth.forEach((days, m) => {
    for (let d = 1; d <= days; d++) {
      for (let h = 1; h <= 24; h++) {
        const dry = 15 + 12 * Math.sin((2 * Math.PI * hour) / HOURS_PER_YEAR);
        const dew = dry - 4 - 3 * Math.cos((2 * Math.PI * h) / 24);
        rows.push(`2020,${m + 1},${d},${h},0,flags,${dry.toFixed(2)},${dew.toFixed(2)},60,100000`);
        hour++;
      }
    }
  });
  return [...header, ...rows].join('\n');
}

describe('climate presets', () => {
  it('climate series have 8760 hours', () => {
    for (const id of CLIMATE_IDS) {
      const climate = loadClimate(id);
      expect(climate.id).toBe(id);
      expect(climate.dryBulbC).toHaveLength(HOURS_PER_YEAR);
      expect(climate.wetBulbC).toHaveLength(HOURS_PER_YEAR);
      expect(climate.dryBulbC.every(Number.isFinite)).toBe(true);
      expect(climate.wetBulbC.every(Number.isFinite)).toBe(true);
    }
  });

  it('Dallas July mean dry-bulb within 1 °C of normals', () => {
    const { dryBulbC } = loadClimate('climate.dallas');
    const july = dryBulbC.slice(JULY_HOURS.first, JULY_HOURS.first + JULY_HOURS.count);
    expect(Math.abs(mean(july) - DALLAS_JULY_NORMAL_C)).toBeLessThanOrEqual(1);
  });

  it('wet-bulb never exceeds dry-bulb', () => {
    for (const id of CLIMATE_IDS) {
      const { dryBulbC, wetBulbC } = loadClimate(id);
      expect(wetBulbC.every((wb, i) => wb <= dryBulbC[i])).toBe(true);
    }
  });

  it('wet-bulb matches the psychrometric chart', async () => {
    const { wetBulbC } = await loadScript();
    // ASHRAE Fundamentals psychrometric chart, sea level: 30 °C dry-bulb, 20 °C dew point → about 22.9 °C wet-bulb.
    expect(wetBulbC(30, 20, 101325)).toBeCloseTo(22.9, 0);
    expect(wetBulbC(10, 10, 101325)).toBeCloseTo(10, 5);
    expect(wetBulbC(-5, -10, 101325)).toBeLessThanOrEqual(-5);
  });

  it('synthesis is deterministic', async () => {
    const { STATIONS, parseEpw, climateEntry } = await loadScript();
    const text = syntheticEpw();
    const first = JSON.stringify(climateEntry(STATIONS[0], parseEpw(text)));
    const second = JSON.stringify(climateEntry(STATIONS[0], parseEpw(text)));
    expect(second).toBe(first);
    const entry = climateEntry(STATIONS[0], parseEpw(text));
    expect(entry.dryBulbC).toHaveLength(HOURS_PER_YEAR);
    expect(entry.wetBulbC.every((wb, i) => wb <= entry.dryBulbC[i])).toBe(true);
    expect(Math.max(...entry.wetBulbC)).toBeLessThanOrEqual(24);
  });
});
