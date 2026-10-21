// git-config.mjs - compatibility shim -> machine.mjs (ADR-0002).

export {
  hooksPath, hooksPathEffective, setHooksPath, isGitRepo, gitVersion,
  localHooksPathOverride,
} from './machine.mjs';
