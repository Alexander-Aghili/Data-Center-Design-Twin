export const GPU = {
  B300: 'gpu.b300',
  GB300: 'gpu.gb300',
  VR200: 'gpu.vr200',
  MI355X: 'gpu.mi355x',
  MI455X: 'gpu.mi455x',
} as const

export const RACK = {
  HGX_B300_AIR: 'rack.hgx-b300-air',
  GB300_NVL72: 'rack.gb300-nvl72',
  VR_NVL72: 'rack.vr-nvl72',
  MI355X_AIR: 'rack.mi355x-air',
  HELIOS: 'rack.helios',
  NETWORK: 'rack.network',
  STORAGE: 'rack.storage',
} as const

export const RACK_COOLING = {
  AIR_CONTAINED: 'rackCooling.air-contained',
  RDHX_PASSIVE: 'rackCooling.rdhx-passive',
  RDHX_ACTIVE: 'rackCooling.rdhx-active',
  DLC_1P: 'rackCooling.dlc-1p',
  DLC_2P: 'rackCooling.dlc-2p',
  IMMERSION_1P: 'rackCooling.immersion-1p',
  IMMERSION_2P: 'rackCooling.immersion-2p',
} as const

export const HEAT_REJECTION = {
  CHILLER_AIR: 'heatRejection.chiller-air',
  DRY_COOLER: 'heatRejection.dry-cooler',
  ADIABATIC_DRY_COOLER: 'heatRejection.adiabatic-dry-cooler',
  COOLING_TOWER: 'heatRejection.cooling-tower',
} as const

export const COOLANT = {
  WATER: 'coolant.water',
  PG25: 'coolant.pg25',
  PG40: 'coolant.pg40',
  DIELECTRIC_OIL: 'coolant.dielectric-oil',
  REFRIGERANT_2P: 'coolant.refrigerant-2p',
  FLUOROCARBON_2P: 'coolant.fluorocarbon-2p',
} as const

export const EQUIPMENT = {
  CDU_1200KW: 'cdu.1200kw',
  CDU_2000KW: 'cdu.2000kw',
  CRAH_200KW: 'crah.200kw',
  CRAH_400KW: 'crah.400kw',
  BUFFER_TANK_STANDARD: 'bufferTank.standard',
  BUSWAY_1250A: 'busway.1250a',
  BUSWAY_2500A: 'busway.2500a',
  UPS_500KW: 'ups.500kw',
  TRANSFORMER_3MVA: 'transformer.3mva',
  LEAF_64X800G: 'leaf.64x800g',
  OPTIC_800G: 'optic.800g',
  CABLE_DAC: 'cable.dac',
  CABLE_AEC: 'cable.aec',
  CABLE_FIBER: 'cable.fiber',
} as const

export const CLIMATE = {
  DALLAS: 'climate.dallas',
  PHOENIX: 'climate.phoenix',
  FRANKFURT: 'climate.frankfurt',
  STOCKHOLM: 'climate.stockholm',
} as const

/** Every built-in catalog id, grouped by catalog kind. */
export const BUILTIN_IDS = {
  gpu: Object.values(GPU),
  rack: Object.values(RACK),
  rackCooling: Object.values(RACK_COOLING),
  heatRejection: Object.values(HEAT_REJECTION),
  coolant: Object.values(COOLANT),
  equipment: Object.values(EQUIPMENT),
  climate: Object.values(CLIMATE),
} as const
