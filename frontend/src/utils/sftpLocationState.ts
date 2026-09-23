export interface SftpLocationState {
  localCwd: string;
  remoteCwd: string;
  localHome: string;
  remoteHome: string;
  localBack: string[];
  localFwd: string[];
  remoteBack: string[];
  remoteFwd: string[];
}

export type SftpLocationPatch = Partial<SftpLocationState>;

const locations = new Map<string, SftpLocationState>();

function freshState(): SftpLocationState {
  return {
    localCwd: "",
    remoteCwd: "",
    localHome: "",
    remoteHome: "",
    localBack: [],
    localFwd: [],
    remoteBack: [],
    remoteFwd: [],
  };
}

// The state is intentionally host-scoped; the component may be mounted again
// when the workspace switches, but a host's browser location must not change.
export function getSftpLocation(host: string): SftpLocationState {
  const key = host.trim();
  if (!key) return freshState();
  const current = locations.get(key);
  if (current) return cloneState(current);
  const initial = freshState();
  locations.set(key, initial);
  return cloneState(initial);
}

export function saveSftpLocation(host: string, patch: SftpLocationPatch): SftpLocationState {
  const key = host.trim();
  if (!key) return { ...freshState(), ...patch };
  const current = locations.get(key) || freshState();
  const next: SftpLocationState = {
    ...current,
    ...patch,
    localBack: patch.localBack ? [...patch.localBack] : [...current.localBack],
    localFwd: patch.localFwd ? [...patch.localFwd] : [...current.localFwd],
    remoteBack: patch.remoteBack ? [...patch.remoteBack] : [...current.remoteBack],
    remoteFwd: patch.remoteFwd ? [...patch.remoteFwd] : [...current.remoteFwd],
  };
  locations.set(key, next);
  return cloneState(next);
}

function cloneState(state: SftpLocationState): SftpLocationState {
  return {
    ...state,
    localBack: [...state.localBack],
    localFwd: [...state.localFwd],
    remoteBack: [...state.remoteBack],
    remoteFwd: [...state.remoteFwd],
  };
}
