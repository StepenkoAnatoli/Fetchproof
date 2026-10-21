// config.mjs - compatibility shim -> machine.mjs (ADR-0002).
//
// One module reaches outside the project. This file exists so an older import path
// keeps working; it adds nothing and decides nothing.

export {
  loadConfig, saveConfig, posture, readMachineConfig, configPath,
  DEFAULTS, CONFIG_PATH, KIT_HOME,
} from './machine.mjs';
