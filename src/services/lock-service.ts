export interface LockStatus {
  deviceName: string;
  state: "locked" | "unlocked";
}

// Discord depends only on this contract. Future adapters belong behind this boundary.
export interface LockService {
  getStatus(): Promise<LockStatus>;
  lock(): Promise<void>;
  unlock(): Promise<void>;
}

// Volatile state, scoped to one Worker isolate; never a real device's source of truth.
export class MockLockService implements LockService {
  private state: LockStatus["state"] = "locked";

  async getStatus(): Promise<LockStatus> {
    return { deviceName: "Studio Door", state: this.state };
  }

  async lock(): Promise<void> {
    this.state = "locked";
  }

  async unlock(): Promise<void> {
    this.state = "unlocked";
  }
}
